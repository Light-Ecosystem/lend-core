// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {IPool} from '../../interfaces/IPool.sol';
import {L2HToken} from '../../protocol/tokenization/L2HToken.sol';

contract MockL2HToken is L2HToken {
  constructor(IPool pool) L2HToken(pool) {}
}
