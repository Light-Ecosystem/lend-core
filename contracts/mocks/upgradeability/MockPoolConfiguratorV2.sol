// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {PoolConfigurator} from '../../protocol/pool/PoolConfigurator.sol';

contract MockPoolConfiguratorV2 is PoolConfigurator {
  bool public updated = true;

  function getRevision() internal override pure returns (uint256) {
    return 0x2;
  }
}
