// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {Pool} from '../../protocol/pool/Pool.sol';
import {IPoolAddressesProvider} from '../../interfaces/IPoolAddressesProvider.sol';

contract MockPoolV2 is Pool {
  bool public updated = true;
  
  constructor(IPoolAddressesProvider provider) Pool(provider) {}

  function getRevision() internal pure override returns (uint256) {
    return 0x2;
  }
}
