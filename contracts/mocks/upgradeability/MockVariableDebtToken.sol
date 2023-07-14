// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {VariableDebtToken} from '../../protocol/tokenization/VariableDebtToken.sol';
import {IPool} from '../../interfaces/IPool.sol';

contract MockVariableDebtToken is VariableDebtToken {
  bool public updated = true;
  
  constructor(IPool pool) VariableDebtToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 0x2;
  }
}
