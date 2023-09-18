// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {IPool} from '../../interfaces/IPool.sol';
import {L2StableDebtToken} from '../../protocol/tokenization/L2StableDebtToken.sol';

contract MockL2StableDebtToken is L2StableDebtToken {
  constructor(IPool pool) L2StableDebtToken(pool) {}
}
