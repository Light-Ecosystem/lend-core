// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {Math} from '../../dependencies/openzeppelin/contracts/Math.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {IPool} from '../../interfaces/IPool.sol';
import {IL2LendingGauge} from '../../interfaces/IL2LendingGauge.sol';
import {WadRayMath} from '../libraries/math/WadRayMath.sol';
import {DataTypes} from '../libraries/types/DataTypes.sol';
import {VariableDebtToken} from './VariableDebtToken.sol';

/**
 * @title VariableDebtToken
 * @author HopeLend
 * @notice Implements a variable debt token to track the borrowing positions of users
 * at variable rate mode
 * @dev Transfer and approve functionalities are disabled since its a non-transferable token
 */
contract L2VariableDebtToken is VariableDebtToken {

  mapping(uint256 => uint256) public inflationRate;

  /**
   * @dev Constructor.
   * @param pool The address of the Pool contract
   */
  constructor(IPool pool) VariableDebtToken(pool) {
    // Intentionally left blank
  }

  /**
   * @notice Calculate limits which depend on the amount of lp Token per-user.
   *        Effectively it calculates working balances to apply amplification
   *        of LT production by LT
   * @param _addr User address
   * @param _l User's amount of liquidity (LP tokens)
   * @param _L Total amount of liquidity (LP tokens)
   */
  function _updateLiquidityLimit(
    address _addr,
    uint256 _l,
    uint256 _L
  ) internal override {
    uint256 _lim = (_l * _TOKENLESS_PRODUCTION) / 100;
    uint256 _votingBalance = IERC20(address(votingEscrow)).balanceOf(_addr);
    uint256 _votingTotal = IERC20(address(votingEscrow)).totalSupply();
    if (address(votingEscrow) != address(0)) {
      if (_votingTotal > 0) {
        // 0.4 * _l + 0.6 * _L * balance / total
        _lim += (_L * _votingBalance * (100 - _TOKENLESS_PRODUCTION)) / _votingTotal / 100;
      }
    }
    _lim = Math.min(_l, _lim);

    uint256 _oldBal = workingBalances[_addr];
    workingBalances[_addr] = _lim;
    uint256 _workingSupply = workingSupply + _lim - _oldBal;
    workingSupply = _workingSupply;

    emit UpdateLiquidityLimit(_addr, _l, _L, _lim, _workingSupply, _votingBalance, _votingTotal);
  }

  /**
   * @notice Checkpoint for a user
   * @param _addr User address
   *
   *This function does,
   *1. Calculate Iis for All: Calc and add Iis for every week. Iis only increses over time.
   *2. Calculate Iu for _addr: Calc by (defferece between Iis(last time) and Iis(this time))* LP deposit amount of _addr(include  locking boost)
   *
   * working_supply & working_balance = total_supply & total_balance with  locking boost。
   * Check whitepaper about Iis and Iu.
   */
  function _checkpoint(
    address _addr,
    uint256 _allocation,
    DataTypes.CheckPointParameters memory _st
  ) internal override {
    if (block.timestamp > _st.periodTime) {
      uint256 _workingSupply = workingSupply;
      uint256 _prevWeekTime = _st.periodTime;
      uint256 _weekTime = Math.min(((_st.periodTime + _WEEK) / _WEEK) * _WEEK, block.timestamp);
      for (uint256 i; i < 500; i++) {
        uint256 _dt = _weekTime - _prevWeekTime;
        uint256 _prevWeekTimeRound = _prevWeekTime / _WEEK;

        if (inflationRate[_prevWeekTimeRound] == 0) {
          inflationRate[_prevWeekTimeRound] = IL2LendingGauge(address(lendingGauge)).inflationRate(_prevWeekTimeRound);
        }

        if (_workingSupply > 0) {
          _integrateInvSupply += (inflationRate[_prevWeekTimeRound] * 10**18 * _allocation * _dt) / _workingSupply / WadRayMath.RAY;
        }

        if (_weekTime == block.timestamp) {
          break;
        }
        _prevWeekTime = _weekTime;
        _weekTime = Math.min(_weekTime + _WEEK, block.timestamp);
      }
    }
    uint256 _workingBalance = workingBalances[_addr];
    integrateFraction[_addr] += (_workingBalance * (_integrateInvSupply - integrateInvSupplyOf[_addr])) / 10**18;
    integrateInvSupplyOf[_addr] = _integrateInvSupply;
    integrateCheckpointOf[_addr] = block.timestamp;
  }
}
