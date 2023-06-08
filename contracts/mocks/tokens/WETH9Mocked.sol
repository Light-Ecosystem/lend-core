// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {WETH9} from '../../dependencies/weth/WETH9.sol';
import {Ownable2Step} from '../../dependencies/openzeppelin/contracts/Ownable2Step.sol';
import {AccessControl} from '../../dependencies/openzeppelin/contracts/AccessControl.sol';

contract WETH9Mocked is WETH9, Ownable2Step, AccessControl {
  bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');
    constructor(string memory _name, string memory _symbol, address faucet) {
        name = _name;
        symbol = _symbol;
        _grantRole(MINTER_ROLE, _msgSender());
        _grantRole(MINTER_ROLE, faucet);
    }

    // Mint not backed by Ether: only for testing purposes
    function mint(uint256 value) public returns (bool) {
        require(hasRole(MINTER_ROLE, _msgSender()), "Only minter");
        balanceOf[msg.sender] += value;
        emit Transfer(address(0), msg.sender, value);
        return true;
    }

    function mint(address account, uint256 value) public returns (bool) {
        require(hasRole(MINTER_ROLE, _msgSender()), "Only minter");
        balanceOf[account] += value;
        emit Transfer(address(0), account, value);
        return true;
    }

  function isMinter(address _minter) external view returns (bool) {
    return hasRole(MINTER_ROLE, _minter);
  }

  function addMinter(address _minter) external onlyOwner {
    _grantRole(MINTER_ROLE, _minter);
  }

  function removeMinter(address _minter) external onlyOwner {
    _revokeRole(MINTER_ROLE, _minter);
  }
}
