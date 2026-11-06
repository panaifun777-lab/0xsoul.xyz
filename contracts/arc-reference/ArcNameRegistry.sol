// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArcNameRegistry} from "./interfaces/IArcNameRegistry.sol";

/// @dev ERC-721 接收方接口（自实现，避免引入 OpenZeppelin）
interface IERC721ReceiverArc {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/**
 * @title ArcNameRegistry
 * @notice Arc 域名所有权登记合约：最小 ERC-721 实现 + 域名扩展状态（到期时间 / 解析器 / label / tld）。
 *
 * 设计要点：
 * 1. tokenId = uint256(keccak256(bytes(fullName)))，fullName = label + "." + tld（全小写）。
 *    因此同一个 label 在不同 TLD 下是不同 tokenId，例如 "abcd.arc" 与 "abcd.web4"。
 * 2. 只有被 owner 授权的 registrar（ArcNameRegistrar）可以 mint / renewExpiry / burn。
 * 3. 已过期的域名不允许转让（transferFrom / safeTransferFrom 直接 revert），
 *    只能等 registrar 在重新注册时调用 burn 回收。
 * 4. 合约自包含：不依赖任何外部库，防重入与权限控制均在本文件内实现。
 * 5. 管理权硬编码为 PROTOCOL_OWNER 常量，构造后即锁定，不可转移（无 transferOwnership）。
 */
contract ArcNameRegistry is IArcNameRegistry {
    /* -------------------------------- 常量 -------------------------------- */
    /// @notice 协议终极管理权地址（硬编码，不可变更；同时是收益最终受益人）
    address public constant PROTOCOL_OWNER = 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1;

    /* -------------------------------- 错误 -------------------------------- */
    error NotRegistryOwner();
    error NotAuthorized();
    error NotRegistrar();
    error NonexistentToken(uint256 tokenId);
    error TokenAlreadyExists(uint256 tokenId);
    error NameExpired(uint256 tokenId);
    error ZeroAddress();
    error EmptyString();
    error UnsafeRecipient();

    /* -------------------------------- 事件 -------------------------------- */
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /* ------------------------------ ERC-721 状态 ------------------------------ */
    string private constant _NAME = "Arc Name Service";
    string private constant _SYMBOL = "ANS";

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /* ------------------------------ 域名扩展状态 ------------------------------ */
    /// @dev tokenId => 到期时间戳（秒）
    mapping(uint256 => uint64) private _expiryOf;
    /// @dev tokenId => 解析器合约地址
    mapping(uint256 => address) private _resolverOf;
    /// @dev tokenId => 域名主体
    mapping(uint256 => string) private _labelOf;
    /// @dev tokenId => 顶级域
    mapping(uint256 => string) private _tldOf;
    /// @dev tokenId => 是否已铸造
    mapping(uint256 => bool) private _exists;

    /* ------------------------------ 权限与元数据 ------------------------------ */
    address private _owner;
    string private _baseURI;

    /// @notice 被授权的 registrar（可 mint / 续期 / 回收）
    mapping(address => bool) public isRegistrar;

    /// @dev 无参构造：管理权直接锁定到 PROTOCOL_OWNER，永久不可转移
    constructor() {
        _owner = PROTOCOL_OWNER;
        emit OwnershipTransferred(address(0), PROTOCOL_OWNER);
    }

    /* -------------------------------- 修饰器 -------------------------------- */
    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotRegistryOwner();
        _;
    }

    modifier onlyRegistrar() {
        if (!isRegistrar[msg.sender]) revert NotRegistrar();
        _;
    }

    /* ------------------------------ ERC-721 元数据 ------------------------------ */
    function name() external pure returns (string memory) {
        return _NAME;
    }

    function symbol() external pure returns (string memory) {
        return _SYMBOL;
    }

    /// @inheritdoc IArcNameRegistry
    function owner() external view returns (address) {
        return _owner;
    }

    /// @notice 协议终极管理权地址（常量，便于链下校验）
    function protocolOwner() external pure returns (address) {
        return PROTOCOL_OWNER;
    }

    /* ------------------------------ ERC-721 查询 ------------------------------ */
    function balanceOf(address account) public view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken(tokenId);
        return tokenOwner;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (!_exists[tokenId]) revert NonexistentToken(tokenId);
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /* ------------------------------ ERC-721 授权 ------------------------------ */
    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        // 仅持有者本人或其 operator 可以授权
        if (msg.sender != tokenOwner && !_operatorApprovals[tokenOwner][msg.sender]) revert NotAuthorized();
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert NotAuthorized();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /* ------------------------------ ERC-721 转让 ------------------------------ */
    function transferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
        _checkReceiver(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        _transfer(from, to, tokenId);
        _checkReceiver(from, to, tokenId, data);
    }

    /// @dev 转让核心逻辑：鉴权 + 过期校验 + 清空授权 + 记账
    function _transfer(address from, address to, uint256 tokenId) private {
        address tokenOwner = ownerOf(tokenId);
        if (tokenOwner != from) revert NotAuthorized();
        if (msg.sender != tokenOwner && msg.sender != _tokenApprovals[tokenId]
            && !_operatorApprovals[tokenOwner][msg.sender]) {
            revert NotAuthorized();
        }
        if (to == address(0)) revert ZeroAddress();
        // 域名已过期则冻结转让，避免过期域名被二次流通
        if (_expiryOf[tokenId] <= block.timestamp) revert NameExpired(tokenId);

        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    /// @dev 转让给合约时校验 onERC721Received
    function _checkReceiver(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721ReceiverArc(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 ret) {
            if (ret != IERC721ReceiverArc.onERC721Received.selector) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }

    /* ------------------------------ 域名扩展查询 ------------------------------ */
    function exists(uint256 tokenId) external view returns (bool) {
        return _exists[tokenId];
    }

    function expiryOf(uint256 tokenId) external view returns (uint64) {
        return _expiryOf[tokenId];
    }

    function resolverOf(uint256 tokenId) external view returns (address) {
        return _resolverOf[tokenId];
    }

    /// @notice 由完整域名（label.tld，全小写）推导 tokenId
    function tokenIdOf(string calldata fullName) public pure returns (uint256) {
        return uint256(keccak256(bytes(fullName)));
    }

    /// @notice 域名主体（不含 .tld）
    function labelOf(uint256 tokenId) external view returns (string memory) {
        return _labelOf[tokenId];
    }

    /// @notice 顶级域（不含点）
    function tldOf(uint256 tokenId) external view returns (string memory) {
        return _tldOf[tokenId];
    }

    /* ------------------------------ 域名扩展写入 ------------------------------ */
    /// @notice 设置解析器；持有者、被授权者或 registrar（注册后自动挂载默认解析器）可调用
    function setResolver(uint256 tokenId, address resolver) external {
        address tokenOwner = ownerOf(tokenId);
        if (
            msg.sender != tokenOwner && msg.sender != _tokenApprovals[tokenId]
                && !_operatorApprovals[tokenOwner][msg.sender] && !isRegistrar[msg.sender]
        ) {
            revert NotAuthorized();
        }
        _resolverOf[tokenId] = resolver;
        emit ResolverUpdated(tokenId, resolver);
    }

    /// @notice 授权 / 取消授权 registrar
    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        isRegistrar[registrar] = allowed;
        emit RegistrarUpdated(registrar, allowed);
    }

    /// @notice 铸造域名，仅 registrar 可调用
    function mint(string calldata label, string calldata tld, address to, uint64 expiry)
        external
        onlyRegistrar
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(label).length == 0 || bytes(tld).length == 0) revert EmptyString();

        tokenId = uint256(keccak256(bytes(string.concat(label, ".", tld))));
        if (_exists[tokenId]) revert TokenAlreadyExists(tokenId);

        _exists[tokenId] = true;
        _labelOf[tokenId] = label;
        _tldOf[tokenId] = tld;
        _expiryOf[tokenId] = expiry;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(address(0), to, tokenId);
        emit NameRegistered(tokenId, label, tld, to, expiry);
    }

    /// @notice 续期（更新到期时间），仅 registrar 可调用
    function renewExpiry(uint256 tokenId, uint64 newExpiry) external onlyRegistrar {
        if (!_exists[tokenId]) revert NonexistentToken(tokenId);
        _expiryOf[tokenId] = newExpiry;
    }

    /// @notice 回收（销毁）域名，仅 registrar 可调用，用于过期域名重新注册
    function burn(uint256 tokenId) external onlyRegistrar {
        address tokenOwner = ownerOf(tokenId);
        delete _tokenApprovals[tokenId];
        delete _owners[tokenId];
        delete _expiryOf[tokenId];
        delete _resolverOf[tokenId];
        delete _labelOf[tokenId];
        delete _tldOf[tokenId];
        delete _exists[tokenId];
        _balances[tokenOwner] -= 1;

        emit Transfer(tokenOwner, address(0), tokenId);
    }

    /* ------------------------------ 元数据 URI ------------------------------ */
    /// @notice 设置 tokenURI 前缀；为空时 tokenURI 返回空字符串
    function setBaseURI(string calldata uri) external onlyOwner {
        _baseURI = uri;
    }

    /// @notice tokenURI = baseURI + label + "." + tld（不做 base64 拼接，元数据由后端渲染）
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (!_exists[tokenId]) revert NonexistentToken(tokenId);
        if (bytes(_baseURI).length == 0) return "";
        return string.concat(_baseURI, _labelOf[tokenId], ".", _tldOf[tokenId]);
    }
}
