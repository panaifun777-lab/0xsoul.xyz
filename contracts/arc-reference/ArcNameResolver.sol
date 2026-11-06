// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArcNameResolver} from "./interfaces/IArcNameResolver.sol";
import {IArcNameRegistry} from "./interfaces/IArcNameRegistry.sol";

/**
 * @title ArcNameResolver
 * @notice 域名解析记录合约：内容哈希（contenthash）、多链地址（addr）、文本记录（text）、主域名（name）。
 *
 * 权限模型：所有写操作要求 msg.sender == registry.ownerOf(tokenId)。
 * 不做 approve/operator 代理写入，避免授权面扩散；需要代写时由持有者本人签名交易。
 * 读操作对所有人开放（链下解析服务直接 eth_call）。
 * 管理权硬编码为 PROTOCOL_OWNER 常量，构造后即锁定，不可转移。
 */
contract ArcNameResolver is IArcNameResolver {
    /* -------------------------------- 常量 -------------------------------- */
    /// @notice 协议终极管理权地址（硬编码，不可变更）
    address public constant PROTOCOL_OWNER = 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1;

    /* -------------------------------- 错误 -------------------------------- */
    error NotResolverOwner();
    error ZeroAddress();
    error NotNameOwner(uint256 tokenId);
    error EmptyKey();

    /* -------------------------------- 事件 -------------------------------- */
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /* -------------------------------- 状态 -------------------------------- */
    /// @notice 域名登记合约（所有权唯一事实源）
    IArcNameRegistry public immutable registry;

    address private _owner;

    /// @dev tokenId => 内容哈希
    mapping(uint256 => bytes) private _contenthash;
    /// @dev tokenId => coinType => 地址字节
    mapping(uint256 => mapping(uint256 => bytes)) private _addr;
    /// @dev tokenId => key => value
    mapping(uint256 => mapping(string => string)) private _text;
    /// @dev tokenId => 主域名（完整域名，如 "abcd.web4"）
    mapping(uint256 => string) private _name;

    /* -------------------------------- 修饰器 -------------------------------- */
    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotResolverOwner();
        _;
    }

    /// @dev 仅域名持有者可写
    modifier onlyNameOwner(uint256 tokenId) {
        if (registry.ownerOf(tokenId) != msg.sender) revert NotNameOwner(tokenId);
        _;
    }

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IArcNameRegistry(registry_);
        _owner = PROTOCOL_OWNER;
        emit OwnershipTransferred(address(0), PROTOCOL_OWNER);
    }

    /// @notice 当前合约管理地址
    function owner() external view returns (address) {
        return _owner;
    }

    /// @notice 协议终极管理权地址（常量，便于链下校验）
    function protocolOwner() external pure returns (address) {
        return PROTOCOL_OWNER;
    }

    /* ------------------------------ 内容哈希 ------------------------------ */
    function setContenthash(uint256 tokenId, bytes calldata hash) external onlyNameOwner(tokenId) {
        _contenthash[tokenId] = hash;
        emit ContenthashChanged(tokenId, hash);
    }

    function contenthash(uint256 tokenId) external view returns (bytes memory) {
        return _contenthash[tokenId];
    }

    /* ------------------------------ 多链地址 ------------------------------ */
    /// @param coinType SLIP-44 币种编号（60 = ETH/Arc，0 = BTC，501 = SOL，2147483785 等 EVM 链见文档）
    function setAddr(uint256 tokenId, uint256 coinType, bytes calldata addrBytes)
        external
        onlyNameOwner(tokenId)
    {
        _addr[tokenId][coinType] = addrBytes;
        emit AddrChanged(tokenId, coinType, addrBytes);
    }

    function addr(uint256 tokenId, uint256 coinType) external view returns (bytes memory) {
        return _addr[tokenId][coinType];
    }

    /* ------------------------------ 文本记录 ------------------------------ */
    function setText(uint256 tokenId, string calldata key, string calldata value)
        external
        onlyNameOwner(tokenId)
    {
        if (bytes(key).length == 0) revert EmptyKey();
        _text[tokenId][key] = value;
        emit TextChanged(tokenId, key, value);
    }

    function text(uint256 tokenId, string calldata key) external view returns (string memory) {
        return _text[tokenId][key];
    }

    /* ------------------------------ 主域名 ------------------------------ */
    function setName(uint256 tokenId, string calldata primaryName) external onlyNameOwner(tokenId) {
        _name[tokenId] = primaryName;
        emit NameChanged(tokenId, primaryName);
    }

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _name[tokenId];
    }

    /* ------------------------------ 批量读取 ------------------------------ */
    /// @notice 一次性读取常用记录，减少链下 RPC 次数
    function records(uint256 tokenId, uint256 coinType, string[] calldata keys)
        external
        view
        returns (bytes memory contentHash_, bytes memory addressBytes_, string[] memory values_)
    {
        contentHash_ = _contenthash[tokenId];
        addressBytes_ = _addr[tokenId][coinType];
        uint256 n = keys.length;
        values_ = new string[](n);
        for (uint256 i = 0; i < n; i++) {
            values_[i] = _text[tokenId][keys[i]];
        }
    }
}
