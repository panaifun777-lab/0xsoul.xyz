// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArcNameRegistrar} from "./interfaces/IArcNameRegistrar.sol";
import {IArcNameRegistry} from "./interfaces/IArcNameRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @dev 极简 SafeERC20：对 transferFrom / transfer 同时兼容「返回 bool」与「无返回值」两种实现，
 *      失败（revert 或返回 false）一律向上抛错，绝不静默吞掉失败。
 */
library SafeERC20Arc {
    error SafeERC20TransferFailed();

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeERC20TransferFailed();
    }

    function safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeERC20TransferFailed();
    }
}

/**
 * @title ArcNameRegistrar
 * @notice 域名注册 / 续费 / 拍卖控制器：定价、长度档位开关、TLD 白名单、USDC 收款、调用 Registry 铸造。
 *
 * 关键约定：
 * - 所有价格单位为 USDC 最小单位（6 位小数），1 USDC = 1_000_000。
 * - 域名主体（label）必须由后端转小写后传入；合约内仍会做一次严格校验兜底。
 * - USDC 通过 transferFrom(payer, treasury, price) 直接进入金库，合约不留存资金。
 * - 管理权与收益权同址：_owner 与 treasury 均硬编码为 PROTOCOL_OWNER，构造后不可变更。
 *
 * 注册权限分层（v2）：
 * - 1 / 2 字符：仅可通过「拍卖」获得；拍卖由协议创建者（终极管理地址）发起（startAuction）。
 * - 3 字符：仅协议创建者（终极管理地址）可直接注册（register / mintReserved），价格 160 USDC / 年。
 * - 4 字符及以上：公开开放（lengthStatus == OPEN 即可），4 字符 16 USDC / 年，5+ 字符 8 USDC / 年。
 * - 创建者始终可通过 mintReserved 直接铸造任意长度域名（含团队域名 x.web4 / x.web5 / x.soul）。
 */
contract ArcNameRegistrar is IArcNameRegistrar {
    /* -------------------------------- 类型 -------------------------------- */
    /// @dev 长度档位状态：0 保留 / 1 即将开放 / 2 已开放
    enum LengthStatus {
        RESERVED,
        COMING_SOON,
        OPEN
    }

    /// @dev 拍卖记录
    struct Auction {
        bool active;
        string label;
        string tld;
        uint256 reservePrice; // USDC 最小单位（6 位小数）
        uint64 endTs;
        address highestBidder;
        uint256 highestBid;
        bool finalized;
        address winner;
    }

    /* -------------------------------- 常量 -------------------------------- */
    /// @notice 协议终极管理权 + 最终受益地址（硬编码，不可变更；管理与收益同址）
    address public constant PROTOCOL_OWNER = 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1;
    /// @notice 单次注册 / 续费的最长年限
    uint16 public constant MAX_YEARS = 10;
    /// @notice 一年按 365 天计
    uint64 public constant SECONDS_PER_YEAR = 365 days;
    /// @notice 过期后的宽限期，宽限期内仍可续费
    uint64 public constant GRACE_PERIOD = 30 days;
    /// @notice label 长度上限
    uint256 public constant MAX_LABEL_LENGTH = 63;
    /// @notice 拍卖最短时长（秒）
    uint64 public constant MIN_AUCTION_DURATION = 60;

    /* -------------------------------- 错误 -------------------------------- */
    error NotRegistrarOwner();
    error ZeroAddress();
    error EmptyLabel();
    error LabelTooLong(uint256 length);
    error InvalidLabelChar(uint256 index);
    error HyphenAtEdge();
    error TldNotAllowed(string tld);
    error LengthNotOpen(uint256 length);
    error InvalidYears(uint16 durationYears);
    error InvalidLength(uint256 length);
    error InvalidStatus(uint8 status);
    error NameNotAvailable(uint256 tokenId);
    error NameNotRegistered(uint256 tokenId);
    error GracePeriodExpired(uint256 tokenId);
    error NotNameOwner(uint256 tokenId);
    error NativeTransferFailed();
    error Reentrancy();
    /// @dev 1 / 2 字符仅可通过拍卖获得
    error AuctionOnly(uint256 length);
    /// @dev 该长度仅协议创建者可注册
    error CreatorOnly();
    /// @dev 该域名正处于拍卖中，不能走普通注册
    error AuctionInProgress();
    /// @dev 拍卖不存在
    error AuctionNotFound();
    /// @dev 拍卖已结束
    error AuctionEnded();
    /// @dev 拍卖未结束
    error AuctionNotEnded();
    /// @dev 出价低于底价或低于当前最高价
    error BidTooLow();
    /// @dev 拍卖时长非法
    error InvalidDuration();

    /* -------------------------------- 状态 -------------------------------- */
    /// @notice USDC 合约（Arc 上为 0x3600...0000，6 位小数）
    address public immutable usdc;
    /// @notice Registry 合约
    IArcNameRegistry public immutable registry;
    /// @notice 注册后自动挂载的默认解析器
    address public resolver;
    /// @notice 收款地址
    address public treasury;
    /// @notice 合约管理地址
    address private _owner;

    /// @dev 长度 => 开放状态
    mapping(uint8 => LengthStatus) public lengthStatus;
    /// @dev 长度 => 注册价（USDC 最小单位 / 年）
    mapping(uint8 => uint256) public registerPrice;
    /// @dev 长度 => 续费价（USDC 最小单位 / 年）
    mapping(uint8 => uint256) public renewPrice;
    /// @dev keccak256(bytes(tld)) => 是否允许注册
    mapping(bytes32 => bool) public tldAllowed;

    /// @dev 拍卖计数与索引
    uint256 public auctionCount;
    /// @dev auctionId => 拍卖记录
    mapping(uint256 => Auction) public auctions;
    /// @dev keccak256(bytes("label.tld")) => 进行中的拍卖 id（0 表示无）
    mapping(bytes32 => uint256) public auctionOf;

    /// @dev 防重入锁
    uint256 private _locked = 1;

    /* -------------------------------- 事件 -------------------------------- */
    // 注：AuctionCreated / AuctionBid / AuctionFinalized / ReservedMinted 事件已在
    // IArcNameRegistrar 接口中声明，此处随接口继承，无需重复声明。
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ResolverUpdated(address resolver);

    /* -------------------------------- 修饰器 -------------------------------- */
    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotRegistrarOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /**
     * @param usdc_      USDC 合约地址（ERC-20 接口）
     * @param registry_  Registry 合约地址
     * @param resolver_  默认解析器地址
     * @dev 管理地址与收款地址均固定为 PROTOCOL_OWNER，不接受外部传入。
     */
    constructor(address usdc_, address registry_, address resolver_) {
        if (usdc_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        registry = IArcNameRegistry(registry_);
        resolver = resolver_;
        treasury = PROTOCOL_OWNER;
        _owner = PROTOCOL_OWNER;

        _initDefaults();

        emit OwnershipTransferred(address(0), PROTOCOL_OWNER);
        emit TreasuryUpdated(PROTOCOL_OWNER);
        emit ResolverUpdated(resolver_);
    }

    /* -------------------------------- 初始化 -------------------------------- */
    /// @dev 写入默认价格表与档位状态；价格单位 USDC 最小单位（6 位小数），按 1 年计。
    ///      创世期普惠定价：
    ///        4 字符 = 16 USDC；5+ 字符 = 8 USDC；
    ///        3 字符 = 160 USDC（仅创建者可注册）；
    ///        1 / 2 字符 = 走拍卖，由创建者自动生成。
    function _initDefaults() private {
        // 1 字符：走拍卖（永久稀缺，价格为 0）。注册表状态置 RESERVED 以阻止普通注册。
        lengthStatus[1] = LengthStatus.RESERVED;
        registerPrice[1] = 0;
        renewPrice[1] = 0;

        // 2 字符：走拍卖（建议起拍 2560 USDC），注册表状态置 RESERVED。
        lengthStatus[2] = LengthStatus.RESERVED;
        registerPrice[2] = 0;
        renewPrice[2] = 0;

        // 3 字符：160 USDC / 年，仅创建者可注册；状态 COMING_SOON（普通注册走 CreatorOnly 拦截）。
        lengthStatus[3] = LengthStatus.COMING_SOON;
        registerPrice[3] = 160e6;
        renewPrice[3] = 160e6;

        // 4 字符：16 USDC / 年，已开放
        lengthStatus[4] = LengthStatus.OPEN;
        registerPrice[4] = 16e6;
        renewPrice[4] = 16e6;

        // 5..63 字符：标准价 8 USDC / 年，已开放
        for (uint8 len = 5; len <= 63; len++) {
            lengthStatus[len] = LengthStatus.OPEN;
            registerPrice[len] = 8e6;
            renewPrice[len] = 8e6;
        }

        // 默认允许的 TLD（与 shared/arc-config.ts 保持一致）
        // 注意：.arc 已有第三方注册商提供服务，本协议不再提供该 TLD
        tldAllowed[keccak256(bytes("web4"))] = true;
        tldAllowed[keccak256(bytes("web5"))] = true;
        tldAllowed[keccak256(bytes("soul"))] = true;
    }

    /* -------------------------------- 查询 -------------------------------- */
    /// @inheritdoc IArcNameRegistrar
    function quote(uint256 labelLength, uint16 durationYears) external view returns (uint256) {
        if (labelLength == 0 || labelLength > MAX_LABEL_LENGTH) revert InvalidLength(labelLength);
        if (durationYears == 0 || durationYears > MAX_YEARS) revert InvalidYears(durationYears);
        return registerPrice[uint8(labelLength)] * uint256(durationYears);
    }

    /// @inheritdoc IArcNameRegistrar
    function priceOf(uint8 length) external view returns (uint256 register_, uint256 renew_) {
        return (registerPrice[length], renewPrice[length]);
    }

    /// @notice 当前合约管理地址
    function owner() external view returns (address) {
        return _owner;
    }

    /// @notice 域名是否允许「普通公开」注册（拍卖 / 创建者保留域名返回 false）
    function isAvailable(string calldata label, string calldata tld) external view returns (bool) {
        uint256 len = bytes(label).length;
        if (len == 0 || len > MAX_LABEL_LENGTH) return false;
        if (!tldAllowed[keccak256(bytes(tld))]) return false;
        // 1 / 2 字符仅拍卖；3 字符仅创建者；均不可普通注册
        if (len <= 3) return false;
        if (lengthStatus[uint8(len)] != LengthStatus.OPEN) return false;

        bytes32 nameHash = keccak256(bytes(string.concat(label, ".", tld)));
        if (auctionOf[nameHash] != 0) return false;

        uint256 tokenId = registry.tokenIdOf(string.concat(label, ".", tld));
        if (!registry.exists(tokenId)) return true;
        // 已过期且过了宽限期，视为可重新注册
        return registry.expiryOf(tokenId) + GRACE_PERIOD < block.timestamp;
    }

    /* -------------------------------- 注册 -------------------------------- */
    /// @inheritdoc IArcNameRegistrar
    function register(string calldata label, string calldata tld, uint16 durationYears, address recipient)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        _validateLabel(label);
        if (recipient == address(0)) revert ZeroAddress();
        if (durationYears == 0 || durationYears > MAX_YEARS) revert InvalidYears(durationYears);
        if (!tldAllowed[keccak256(bytes(tld))]) revert TldNotAllowed(tld);

        uint256 len = bytes(label).length;
        // 1 / 2 字符：仅拍卖可得
        if (len == 1 || len == 2) revert AuctionOnly(len);
        // 3 字符：仅协议创建者（终极管理地址）可直接注册
        if (len == 3 && msg.sender != _owner) revert CreatorOnly();
        // 4 字符及以上：需处于 OPEN 档位
        if (len >= 4 && lengthStatus[uint8(len)] != LengthStatus.OPEN) revert LengthNotOpen(len);

        bytes32 nameHash = keccak256(bytes(string.concat(label, ".", tld)));
        if (auctionOf[nameHash] != 0) revert AuctionInProgress();

        tokenId = registry.tokenIdOf(string.concat(label, ".", tld));

        // 已存在：只有「过期且超过宽限期」的域名才可被重新注册，需先回收旧 NFT
        if (registry.exists(tokenId)) {
            if (registry.expiryOf(tokenId) + GRACE_PERIOD >= block.timestamp) revert NameNotAvailable(tokenId);
            registry.burn(tokenId);
        }

        uint256 price = registerPrice[uint8(len)] * uint256(durationYears);
        _collect(msg.sender, price);

        uint64 expiry = uint64(block.timestamp) + uint64(durationYears) * SECONDS_PER_YEAR;
        registry.mint(label, tld, recipient, expiry);

        // 注册后挂载默认解析器，前端可立即写入解析记录
        if (resolver != address(0)) registry.setResolver(tokenId, resolver);

        emit NameRegistered(tokenId, label, tld, recipient, expiry, price);
    }

    /**
     * @notice 创建者（终极管理地址）直接铸造任意长度域名（绕过 OPEN 档位与公开注册限制）。
     *         用于：团队域名（x.web4 / x.web5 / x.soul）、1/2/3 字符稀缺域名的定向发放。
     *         若对应长度定价 > 0，则从调用者（创建者）扣款进入金库；定价为 0 则免费铸造。
     */
    function mintReserved(string calldata label, string calldata tld, uint16 durationYears, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenId)
    {
        _validateLabel(label);
        if (recipient == address(0)) revert ZeroAddress();
        if (durationYears == 0 || durationYears > MAX_YEARS) revert InvalidYears(durationYears);
        if (!tldAllowed[keccak256(bytes(tld))]) revert TldNotAllowed(tld);

        uint256 len = bytes(label).length;
        if (len == 0 || len > MAX_LABEL_LENGTH) revert InvalidLength(len);

        bytes32 nameHash = keccak256(bytes(string.concat(label, ".", tld)));
        if (auctionOf[nameHash] != 0) revert AuctionInProgress();

        tokenId = registry.tokenIdOf(string.concat(label, ".", tld));
        if (registry.exists(tokenId)) {
            if (registry.expiryOf(tokenId) + GRACE_PERIOD >= block.timestamp) revert NameNotAvailable(tokenId);
            registry.burn(tokenId);
        }

        uint256 price = registerPrice[uint8(len)] * uint256(durationYears);
        _collect(msg.sender, price);

        uint64 expiry = uint64(block.timestamp) + uint64(durationYears) * SECONDS_PER_YEAR;
        registry.mint(label, tld, recipient, expiry);
        if (resolver != address(0)) registry.setResolver(tokenId, resolver);

        emit ReservedMinted(tokenId, label, tld, recipient, expiry);
        emit NameRegistered(tokenId, label, tld, recipient, expiry, price);
    }

    /* -------------------------------- 续费 -------------------------------- */
    /// @inheritdoc IArcNameRegistrar
    function renew(string calldata label, string calldata tld, uint16 durationYears)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        _validateLabel(label);
        if (durationYears == 0 || durationYears > MAX_YEARS) revert InvalidYears(durationYears);
        if (!tldAllowed[keccak256(bytes(tld))]) revert TldNotAllowed(tld);

        tokenId = registry.tokenIdOf(string.concat(label, ".", tld));
        if (!registry.exists(tokenId)) revert NameNotRegistered(tokenId);

        uint64 currentExpiry = registry.expiryOf(tokenId);
        // 未过期，或已过期但仍在 30 天宽限期内
        if (currentExpiry + GRACE_PERIOD < block.timestamp) revert GracePeriodExpired(tokenId);

        // 仅持有者或被授权者可续费
        address tokenOwner = registry.ownerOf(tokenId);
        if (
            msg.sender != tokenOwner && !registry.isApprovedForAll(tokenOwner, msg.sender)
                && registry.getApproved(tokenId) != msg.sender
        ) {
            revert NotNameOwner(tokenId);
        }

        uint256 len = bytes(label).length;
        uint256 price = renewPrice[uint8(len)] * uint256(durationYears);
        _collect(msg.sender, price);

        // 已过期时从当前时间起算，避免续费后仍然过期
        uint64 base = currentExpiry > block.timestamp ? currentExpiry : uint64(block.timestamp);
        uint64 newExpiry = base + uint64(durationYears) * SECONDS_PER_YEAR;
        registry.renewExpiry(tokenId, newExpiry);

        emit NameRenewed(tokenId, newExpiry, price, durationYears);
    }

    /* -------------------------------- 拍卖（1 / 2 字符） -------------------------------- */
    /**
     * @notice 由创建者（终极管理地址）为某个 1 / 2 字符域名发起拍卖。
     * @param reservePrice 起拍价（USDC 最小单位，6 位小数）
     * @param durationSeconds 拍卖时长（秒），需 >= MIN_AUCTION_DURATION
     */
    function startAuction(string calldata label, string calldata tld, uint256 reservePrice, uint64 durationSeconds)
        external
        onlyOwner
        returns (uint256 auctionId)
    {
        _validateLabel(label);
        if (durationSeconds < MIN_AUCTION_DURATION) revert InvalidDuration();
        if (!tldAllowed[keccak256(bytes(tld))]) revert TldNotAllowed(tld);
        uint256 len = bytes(label).length;
        if (len == 0 || len > MAX_LABEL_LENGTH) revert InvalidLength(len);

        string memory fullName = string.concat(label, ".", tld);
        uint256 tokenId = registry.tokenIdOf(fullName);
        if (registry.exists(tokenId)) revert NameNotAvailable(tokenId);
        bytes32 nameHash = keccak256(bytes(fullName));
        if (auctionOf[nameHash] != 0) revert AuctionInProgress();

        auctionId = ++auctionCount;
        auctions[auctionId] = Auction({
            active: true,
            label: label,
            tld: tld,
            reservePrice: reservePrice,
            endTs: uint64(block.timestamp) + durationSeconds,
            highestBidder: address(0),
            highestBid: 0,
            finalized: false,
            winner: address(0)
        });
        auctionOf[nameHash] = auctionId;

        emit AuctionCreated(auctionId, label, tld, reservePrice, auctions[auctionId].endTs);
    }

    /**
     * @notice 参与拍卖出价。需先 approve 本合约花费 amount 的 USDC。
     *         出价需 >= 底价且高于当前最高价；系统会自动退回上一出价者。
     */
    function bid(uint256 auctionId, uint256 amount) external nonReentrant {
        Auction storage a = auctions[auctionId];
        if (a.endTs == 0) revert AuctionNotFound();
        if (a.finalized) revert AuctionEnded();
        if (block.timestamp >= a.endTs) revert AuctionEnded();
        if (amount < a.reservePrice || amount <= a.highestBid) revert BidTooLow();

        // 退回上一出价者
        if (a.highestBidder != address(0) && a.highestBid > 0) {
            SafeERC20Arc.safeTransfer(usdc, a.highestBidder, a.highestBid);
        }
        // 托管本次出价
        SafeERC20Arc.safeTransferFrom(usdc, msg.sender, address(this), amount);

        a.highestBidder = msg.sender;
        a.highestBid = amount;
        emit AuctionBid(auctionId, msg.sender, amount);
    }

    /**
     * @notice 由创建者（终极管理地址）结束拍卖并结算。
     *         - 有赢家：USDC 转入金库，域名铸造给最高出价者。
     *         - 流拍（无有效出价）：释放该域名，供后续重新发起。
     */
    function finalizeAuction(uint256 auctionId) external onlyOwner {
        Auction storage a = auctions[auctionId];
        if (a.endTs == 0) revert AuctionNotFound();
        if (a.finalized) revert AuctionEnded();
        if (block.timestamp < a.endTs) revert AuctionNotEnded();

        a.finalized = true;
        bytes32 nameHash = keccak256(bytes(string.concat(a.label, ".", a.tld)));
        auctionOf[nameHash] = 0;

        if (a.highestBidder == address(0) || a.highestBid == 0) {
            emit AuctionFinalized(auctionId, address(0), 0);
            return;
        }

        // 结算：托管 USDC 转金库，域名铸造给赢家
        SafeERC20Arc.safeTransfer(usdc, treasury, a.highestBid);
        uint64 expiry = uint64(block.timestamp) + uint64(MAX_YEARS) * SECONDS_PER_YEAR;
        uint256 tokenId = registry.mint(a.label, a.tld, a.highestBidder, expiry);
        if (resolver != address(0)) registry.setResolver(tokenId, resolver);
        a.winner = a.highestBidder;

        emit AuctionFinalized(auctionId, a.highestBidder, a.highestBid);
        emit NameRegistered(tokenId, a.label, a.tld, a.highestBidder, expiry, a.highestBid);
    }

    /* -------------------------------- 管理 -------------------------------- */
    /// @inheritdoc IArcNameRegistrar
    function setLengthStatus(uint8 length, uint8 status) external onlyOwner {
        if (length == 0 || length > MAX_LABEL_LENGTH) revert InvalidLength(length);
        if (status > uint8(LengthStatus.OPEN)) revert InvalidStatus(status);
        lengthStatus[length] = LengthStatus(status);
        emit LengthStatusUpdated(length, status);
    }

    /// @inheritdoc IArcNameRegistrar
    function setLengthPrice(uint8 length, uint256 registerPrice_, uint256 renewPrice_) external onlyOwner {
        if (length == 0 || length > MAX_LABEL_LENGTH) revert InvalidLength(length);
        registerPrice[length] = registerPrice_;
        renewPrice[length] = renewPrice_;
        emit LengthPriceUpdated(length, registerPrice_, renewPrice_);
    }

    /// @notice 最终受益地址（与 PROTOCOL_OWNER 同址，不可变更）
    function beneficiary() external view returns (address) {
        return treasury;
    }

    /// @notice 协议终极管理权地址（常量，便于链下校验）
    function protocolOwner() external pure returns (address) {
        return PROTOCOL_OWNER;
    }

    /// @inheritdoc IArcNameRegistrar
    function setTldStatus(string calldata tld, bool allowed) external onlyOwner {
        if (bytes(tld).length == 0) revert EmptyLabel();
        tldAllowed[keccak256(bytes(tld))] = allowed;
        emit TldStatusUpdated(tld, allowed);
    }

    /// @notice 更新默认解析器（仅管理）
    function setResolver(address resolver_) external onlyOwner {
        resolver = resolver_;
        emit ResolverUpdated(resolver_);
    }

    /// @inheritdoc IArcNameRegistrar
    /// @dev 正常流程下 USDC 直接进入 treasury，本函数只用于处理误转入本合约的资产
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            SafeERC20Arc.safeTransfer(token, to, amount);
        }
    }

    /// @dev 允许合约接收原生资产（Arc 上原生资产即 USDC，18 位小数）
    receive() external payable {}

    /* -------------------------------- 内部逻辑 -------------------------------- */
    /// @dev 向 payer 收取 USDC 并直接转入 treasury
    function _collect(address payer, uint256 price) private {
        if (price == 0) return;
        SafeERC20Arc.safeTransferFrom(usdc, payer, treasury, price);
    }

    /**
     * @dev label 校验：1..63 字节，仅 [a-z0-9-]，且首尾不得为连字符。
     *      后端应已完成小写化与校验，此处为链上兜底。
     */
    function _validateLabel(string calldata label) private pure {
        bytes calldata b = bytes(label);
        uint256 len = b.length;
        if (len == 0) revert EmptyLabel();
        if (len > MAX_LABEL_LENGTH) revert LabelTooLong(len);
        if (b[0] == 0x2d || b[len - 1] == 0x2d) revert HyphenAtEdge();

        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            bool isLower = (c >= 0x61 && c <= 0x7a); // a-z
            bool isDigit = (c >= 0x30 && c <= 0x39); // 0-9
            bool isHyphen = (c == 0x2d); // -
            if (!isLower && !isDigit && !isHyphen) revert InvalidLabelChar(i);
        }
    }
}
