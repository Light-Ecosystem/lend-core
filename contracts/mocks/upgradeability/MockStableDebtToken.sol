// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {StableDebtToken} from '../../protocol/tokenization/StableDebtToken.sol';
import {IPool} from '../../interfaces/IPool.sol';

contract MockStableDebtToken is StableDebtToken {
  bool public updated = true;
  
  constructor(IPool pool) StableDebtToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 0x2;
  }
}
