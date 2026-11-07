// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ArcSoulToken ($0x.SOUL)
 * @notice 0xsoul.xyz 协议在 ARC 公链（EVM 端）的官方原生代币
 */
contract ArcSoulToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**6; // 10亿总量，6位小数对齐 Solana 标准

    constructor(address initialOwner) 
        ERC20("0x.SOUL Pioneer", "0x.SOUL") 
        Ownable(initialOwner) 
    {
        // 将全部 10 亿枚代币初始铸造给协议 Owner / 多签 Treasury
        _mint(initialOwner, TOTAL_SUPPLY);
    }
}
