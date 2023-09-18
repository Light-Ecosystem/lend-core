// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {IPool} from '../../interfaces/IPool.sol';
import {L2VariableDebtToken} from '../../protocol/tokenization/L2VariableDebtToken.sol';

contract MockL2VariableDebtToken is L2VariableDebtToken {
  constructor(IPool pool) L2VariableDebtToken(pool) {}
}
