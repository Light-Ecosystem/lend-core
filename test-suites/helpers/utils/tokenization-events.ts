import { MockHTokenRepayment__factory } from './../../../types/factories/mocks/tokens/MockHTokenRepayment__factory';
import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import { TransactionReceipt } from '@ethersproject/providers';
import {
  HToken,
  HToken__factory,
  IERC20__factory,
  Pool,
  StableDebtToken,
  StableDebtToken__factory,
  VariableDebtToken,
  VariableDebtToken__factory,
} from '../../../types';
import { ZERO_ADDRESS } from '../../../helpers/constants';
import { SignerWithAddress } from '../make-suite';
import { calcExpectedStableDebtTokenBalance } from './calculations';
import { getTxCostAndTimestamp } from '../actions';
import { RateMode } from '../../../helpers/types';
import { convertToCurrencyDecimals } from '../../../helpers/contracts-helpers';
import { matchEvent } from './helpers';
import './wadraymath';
import { expect } from 'chai';
import { rayDiv, rayMul } from './wadraymath';

const ATOKEN_EVENTS = [
  { sig: 'Transfer(address,address,uint256)', args: ['from', 'to', 'value'] },
  {
    sig: 'Mint(address,address,uint256,uint256,uint256)',
    args: ['caller', 'onBehalfOf', 'value', 'balanceIncrease', 'index'],
  },
  {
    sig: 'Burn(address,address,uint256,uint256,uint256)',
    args: ['from', 'target', 'value', 'balanceIncrease', 'index'],
  },
  {
    sig: 'BalanceTransfer(address,address,uint256,uint256)',
    args: ['from', 'to', 'value', 'index'],
  },
];
const VARIABLE_DEBT_TOKEN_EVENTS = [
  { sig: 'Transfer(address,address,uint256)', args: ['from', 'to', 'value'] },
  {
    sig: 'Mint(address,address,uint256,uint256,uint256)',
    args: ['caller', 'onBehalfOf', 'value', 'balanceIncrease', 'index'],
  },
  {
    sig: 'Burn(address,address,uint256,uint256,uint256)',
    args: ['from', 'target', 'value', 'balanceIncrease', 'index'],
  },
];
const STABLE_DEBT_TOKEN_EVENTS = [
  { sig: 'Transfer(address,address,uint256)', args: ['from', 'to', 'value'] },
  {
    sig: 'Mint(address,address,uint256,uint256,uint256,uint256,uint256,uint256)',
    args: [
      'user',
      'onBehalfOf',
      'amount',
      'currentBalance',
      'balanceIncrease',
      'newRate',
      'avgStableRate',
      'newTotalSupply',
    ],
  },
  {
    sig: 'Burn(address,uint256,uint256,uint256,uint256,uint256)',
    args: [
      'from',
      'amount',
      'currentBalance',
      'balanceIncrease',
      'avgStableRate',
      'newTotalSupply',
    ],
  },
];

const getBalanceIncrease = (
  scaledBalance: BigNumber,
  indexBeforeAction: BigNumber,
  indexAfterAction: BigNumber
) => {
  return rayMul(scaledBalance, indexAfterAction).sub(rayMul(scaledBalance, indexBeforeAction));
};

export const supply = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  onBehalfOf: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);

  const previousIndex = await hToken.getPreviousIndex(onBehalfOf);

  const tx = await pool.connect(user.signer).supply(underlying, amount, onBehalfOf, '0');
  const rcpt = await tx.wait();

  const indexAfter = await pool.getReserveNormalizedIncome(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);
  const scaledBalance = (await hToken.scaledBalanceOf(onBehalfOf)).sub(addedScaledBalance);
  const balanceIncrease = getBalanceIncrease(scaledBalance, previousIndex, indexAfter);

  if (debug) printHTokenEvents(hToken, rcpt);
  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [user.address, hToken.address, amount]);
  matchEvent(rcpt, 'Transfer', hToken, hToken.address, [
    ZERO_ADDRESS,
    onBehalfOf,
    amount.add(balanceIncrease),
  ]);
  matchEvent(rcpt, 'Mint', hToken, hToken.address, [
    user.address,
    onBehalfOf,
    amount.add(balanceIncrease),
    balanceIncrease,
    indexAfter,
  ]);
  return rcpt;
};

export const withdraw = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  to: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);

  const previousIndex = await hToken.getPreviousIndex(user.address);

  const tx = await pool.connect(user.signer).withdraw(underlying, amount, to);
  const rcpt = await tx.wait();

  const indexAfter = await pool.getReserveNormalizedIncome(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);
  const scaledBalance = (await hToken.scaledBalanceOf(user.address)).add(addedScaledBalance);
  const balanceIncrease = getBalanceIncrease(scaledBalance, previousIndex, indexAfter);

  if (debug) printHTokenEvents(hToken, rcpt);
  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [hToken.address, to, amount]);

  if (balanceIncrease.gt(amount)) {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [
      ZERO_ADDRESS,
      user.address,
      balanceIncrease.sub(amount),
    ]);
    matchEvent(rcpt, 'Mint', hToken, hToken.address, [
      user.address,
      user.address,
      balanceIncrease.sub(amount),
      balanceIncrease,
      indexAfter,
    ]);
  } else {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [
      user.address,
      ZERO_ADDRESS,
      amount.sub(balanceIncrease),
    ]);
    matchEvent(rcpt, 'Burn', hToken, hToken.address, [
      user.address,
      to,
      amount.sub(balanceIncrease),
      balanceIncrease,
      indexAfter,
    ]);
  }

  return rcpt;
};

export const transfer = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  to: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress } = await pool.getReserveData(underlying);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);

  const fromPreviousIndex = await hToken.getPreviousIndex(user.address);
  const toPreviousIndex = await hToken.getPreviousIndex(to);

  const tx = await hToken.connect(user.signer).transfer(to, amount);
  const rcpt = await tx.wait();

  const indexAfter = await pool.getReserveNormalizedIncome(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);

  // The amount of scaled balance transferred is 0 if self-transfer
  const deltaScaledBalance = user.address == to ? BigNumber.from(0) : addedScaledBalance;
  const fromScaledBalance = (await hToken.scaledBalanceOf(user.address)).add(deltaScaledBalance);
  const toScaledBalance = (await hToken.scaledBalanceOf(to)).sub(deltaScaledBalance);
  const fromBalanceIncrease = getBalanceIncrease(fromScaledBalance, fromPreviousIndex, indexAfter);
  const toBalanceIncrease = getBalanceIncrease(toScaledBalance, toPreviousIndex, indexAfter);

  if (debug) printHTokenEvents(hToken, rcpt);

  matchEvent(rcpt, 'Transfer', hToken, hToken.address, [user.address, to, amount]);
  matchEvent(rcpt, 'BalanceTransfer', hToken, hToken.address, [
    user.address,
    to,
    addedScaledBalance,
    indexAfter,
  ]);
  if (fromBalanceIncrease.gt(0)) {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [
      ZERO_ADDRESS,
      user.address,
      fromBalanceIncrease,
    ]);
    matchEvent(rcpt, 'Mint', hToken, hToken.address, [
      user.address,
      user.address,
      fromBalanceIncrease,
      fromBalanceIncrease,
      indexAfter,
    ]);
  }
  if (user.address != to && toBalanceIncrease.gt(0)) {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [ZERO_ADDRESS, to, toBalanceIncrease]);
    matchEvent(rcpt, 'Mint', hToken, hToken.address, [
      user.address,
      to,
      toBalanceIncrease,
      toBalanceIncrease,
      indexAfter,
    ]);
  }

  return rcpt;
};

export const transferFrom = async (
  pool: Pool,
  user: SignerWithAddress,
  origin: string,
  underlying: string,
  amountToConvert: string,
  to: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress } = await pool.getReserveData(underlying);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);

  const fromPreviousIndex = await hToken.getPreviousIndex(origin);
  const toPreviousIndex = await hToken.getPreviousIndex(to);

  const tx = await hToken.connect(user.signer).transferFrom(origin, to, amount);
  const rcpt = await tx.wait();

  const indexAfter = await pool.getReserveNormalizedIncome(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);

  // The amount of scaled balance transferred is 0 if self-transfer
  const deltaScaledBalance = origin == to ? BigNumber.from(0) : addedScaledBalance;
  const fromScaledBalance = (await hToken.scaledBalanceOf(origin)).add(deltaScaledBalance);
  const toScaledBalance = (await hToken.scaledBalanceOf(to)).sub(deltaScaledBalance);
  const fromBalanceIncrease = getBalanceIncrease(fromScaledBalance, fromPreviousIndex, indexAfter);
  const toBalanceIncrease = getBalanceIncrease(toScaledBalance, toPreviousIndex, indexAfter);

  if (debug) printHTokenEvents(hToken, rcpt);

  matchEvent(rcpt, 'Transfer', hToken, hToken.address, [origin, to, amount]);
  matchEvent(rcpt, 'BalanceTransfer', hToken, hToken.address, [
    origin,
    to,
    addedScaledBalance,
    indexAfter,
  ]);
  if (fromBalanceIncrease.gt(0)) {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [
      ZERO_ADDRESS,
      origin,
      fromBalanceIncrease,
    ]);
    matchEvent(rcpt, 'Mint', hToken, hToken.address, [
      user.address,
      origin,
      fromBalanceIncrease,
      fromBalanceIncrease,
      indexAfter,
    ]);
  }
  if (origin != to && toBalanceIncrease.gt(0)) {
    matchEvent(rcpt, 'Transfer', hToken, hToken.address, [ZERO_ADDRESS, to, toBalanceIncrease]);
    matchEvent(rcpt, 'Mint', hToken, hToken.address, [
      user.address,
      to,
      toBalanceIncrease,
      toBalanceIncrease,
      indexAfter,
    ]);
  }

  return rcpt;
};

export const variableBorrow = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  onBehalfOf: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress, variableDebtTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);
  const variableDebtToken = VariableDebtToken__factory.connect(
    variableDebtTokenAddress,
    user.signer
  );

  let previousIndex = await variableDebtToken.getPreviousIndex(onBehalfOf);

  const tx = await pool
    .connect(user.signer)
    .borrow(underlying, amount, RateMode.Variable, 0, onBehalfOf);
  const rcpt = await tx.wait();

  const indexAfter = await pool.getReserveNormalizedVariableDebt(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);
  const scaledBalance = (await variableDebtToken.scaledBalanceOf(onBehalfOf)).sub(
    addedScaledBalance
  );
  const balanceIncrease = getBalanceIncrease(scaledBalance, previousIndex, indexAfter);

  if (debug) printVariableDebtTokenEvents(variableDebtToken, rcpt);

  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [hToken.address, user.address, amount]);
  matchEvent(rcpt, 'Transfer', variableDebtToken, variableDebtToken.address, [
    ZERO_ADDRESS,
    onBehalfOf,
    amount.add(balanceIncrease),
  ]);
  matchEvent(rcpt, 'Mint', variableDebtToken, variableDebtToken.address, [
    user.address,
    onBehalfOf,
    amount.add(balanceIncrease),
    balanceIncrease,
    indexAfter,
  ]);
  return rcpt;
};

export const repayVariableBorrow = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  onBehalfOf: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress, variableDebtTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);
  const variableDebtToken = VariableDebtToken__factory.connect(
    variableDebtTokenAddress,
    user.signer
  );

  const previousIndex = await variableDebtToken.getPreviousIndex(onBehalfOf);

  const tx = await pool
    .connect(user.signer)
    .repay(underlying, amount, RateMode.Variable, onBehalfOf);
  const rcpt = await tx.wait();

  // check handleRepayment function is correctly called
  await expect(tx)
    .to.emit(MockHTokenRepayment__factory.connect(hTokenAddress, user.signer), 'MockRepayment')
    .withArgs(user.address, onBehalfOf, amount);

  const indexAfter = await pool.getReserveNormalizedVariableDebt(underlying);
  const addedScaledBalance = rayDiv(amount, indexAfter);
  const scaledBalance = (await variableDebtToken.scaledBalanceOf(onBehalfOf)).add(
    addedScaledBalance
  );
  const balanceIncrease = getBalanceIncrease(scaledBalance, previousIndex, indexAfter);

  if (debug) printVariableDebtTokenEvents(variableDebtToken, rcpt);

  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [user.address, hToken.address, amount]);
  if (balanceIncrease.gt(amount)) {
    matchEvent(rcpt, 'Transfer', variableDebtToken, variableDebtToken.address, [
      ZERO_ADDRESS,
      onBehalfOf,
      balanceIncrease.sub(amount),
    ]);
    matchEvent(rcpt, 'Mint', variableDebtToken, variableDebtToken.address, [
      onBehalfOf,
      onBehalfOf,
      balanceIncrease.sub(amount),
      balanceIncrease,
      indexAfter,
    ]);
  } else {
    matchEvent(rcpt, 'Transfer', variableDebtToken, variableDebtToken.address, [
      onBehalfOf,
      ZERO_ADDRESS,
      amount.sub(balanceIncrease),
    ]);
    matchEvent(rcpt, 'Burn', variableDebtToken, variableDebtToken.address, [
      onBehalfOf,
      ZERO_ADDRESS,
      amount.sub(balanceIncrease),
      balanceIncrease,
      indexAfter,
    ]);
  }

  return rcpt;
};

export const stableBorrow = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  onBehalfOf: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress, stableDebtTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);
  const stableDebtToken = StableDebtToken__factory.connect(stableDebtTokenAddress, user.signer);

  const previousIndex = await stableDebtToken.getUserStableRate(onBehalfOf);
  const principalBalance = await stableDebtToken.principalBalanceOf(onBehalfOf);
  const lastTimestamp = await stableDebtToken.getUserLastUpdated(onBehalfOf);

  const tx = await pool
    .connect(user.signer)
    .borrow(underlying, amount, RateMode.Stable, 0, onBehalfOf);
  const rcpt = await tx.wait();

  const { txTimestamp } = await getTxCostAndTimestamp(rcpt);

  const newPrincipalBalance = calcExpectedStableDebtTokenBalance(
    principalBalance,
    previousIndex,
    BigNumber.from(lastTimestamp),
    txTimestamp
  );
  const balanceIncrease = newPrincipalBalance.sub(principalBalance);
  const currentAvgStableRate = await stableDebtToken.getAverageStableRate();
  const stableRateAfter = await stableDebtToken.getUserStableRate(onBehalfOf);
  const [totalSupply] = await stableDebtToken.getSupplyData();

  if (debug) printStableDebtTokenEvents(stableDebtToken, rcpt);

  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [hToken.address, user.address, amount]);
  matchEvent(rcpt, 'Transfer', stableDebtToken, stableDebtToken.address, [
    ZERO_ADDRESS,
    onBehalfOf,
    amount.add(balanceIncrease),
  ]);
  matchEvent(rcpt, 'Mint', stableDebtToken, stableDebtToken.address, [
    user.address,
    onBehalfOf,
    amount.add(balanceIncrease),
    newPrincipalBalance,
    balanceIncrease,
    stableRateAfter,
    currentAvgStableRate,
    totalSupply,
  ]);
  return rcpt;
};

export const repayStableBorrow = async (
  pool: Pool,
  user: SignerWithAddress,
  underlying: string,
  amountToConvert: string,
  onBehalfOf: string,
  debug: boolean = false
) => {
  const amount = await convertToCurrencyDecimals(underlying, amountToConvert);
  const { hTokenAddress, stableDebtTokenAddress } = await pool.getReserveData(underlying);
  const underlyingToken = IERC20__factory.connect(underlying, user.signer);
  const hToken = HToken__factory.connect(hTokenAddress, user.signer);
  const stableDebtToken = StableDebtToken__factory.connect(stableDebtTokenAddress, user.signer);

  const principalBalance = await stableDebtToken.principalBalanceOf(onBehalfOf);
  const previousIndex = await stableDebtToken.getUserStableRate(onBehalfOf);
  const lastTimestamp = await stableDebtToken.getUserLastUpdated(onBehalfOf);

  const tx = await pool.connect(user.signer).repay(underlying, amount, RateMode.Stable, onBehalfOf);
  const rcpt = await tx.wait();

  const { txTimestamp } = await getTxCostAndTimestamp(rcpt);

  const newPrincipalBalance = calcExpectedStableDebtTokenBalance(
    principalBalance,
    previousIndex,
    BigNumber.from(lastTimestamp),
    txTimestamp
  );

  const balanceIncrease = newPrincipalBalance.sub(principalBalance);
  const currentAvgStableRate = await stableDebtToken.getAverageStableRate();
  const stableRateAfter = await stableDebtToken.getUserStableRate(onBehalfOf);
  const [totalSupply] = await stableDebtToken.getSupplyData();

  if (debug) printStableDebtTokenEvents(stableDebtToken, rcpt);

  matchEvent(rcpt, 'Transfer', underlyingToken, underlying, [user.address, hToken.address, amount]);
  if (balanceIncrease.gt(amount)) {
    matchEvent(rcpt, 'Transfer', stableDebtToken, stableDebtToken.address, [
      ZERO_ADDRESS,
      onBehalfOf,
      balanceIncrease.sub(amount),
    ]);
    matchEvent(rcpt, 'Mint', stableDebtToken, stableDebtToken.address, [
      onBehalfOf,
      onBehalfOf,
      balanceIncrease.sub(amount),
      newPrincipalBalance,
      balanceIncrease,
      stableRateAfter,
      currentAvgStableRate,
      totalSupply,
    ]);
  } else {
    matchEvent(rcpt, 'Transfer', stableDebtToken, stableDebtToken.address, [
      onBehalfOf,
      ZERO_ADDRESS,
      amount.sub(balanceIncrease),
    ]);
    matchEvent(rcpt, 'Burn', stableDebtToken, stableDebtToken.address, [
      onBehalfOf,
      amount.sub(balanceIncrease),
      newPrincipalBalance,
      balanceIncrease,
      currentAvgStableRate,
      totalSupply,
    ]);
  }

  return rcpt;
};

export const printHTokenEvents = (hToken: HToken, receipt: TransactionReceipt) => {
  for (const eventSig of ATOKEN_EVENTS) {
    const eventName = eventSig.sig.split('(')[0];
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == hToken.address
    );
    for (const rawEvent of rawEvents) {
      const rawParsed = hToken.interface.decodeEventLog(eventName, rawEvent.data, rawEvent.topics);
      const parsed: any[] = [];

      let i = 0;
      for (const arg of eventSig.args) {
        parsed[i] = ['value', 'balanceIncrease'].includes(arg)
          ? ethers.utils.formatEther(rawParsed[arg])
          : rawParsed[arg];
        i++;
      }

      console.log(`event ${eventName} ${parsed[0]} -> ${parsed[1]}: ${parsed.slice(2).join(' ')}`);
    }
  }
};

export const getHTokenEvent = (hToken: HToken, receipt: TransactionReceipt, eventName: string) => {
  const eventSig = ATOKEN_EVENTS.find((item) => item.sig.split('(')[0] === eventName);
  const results: utils.Result = [];
  if (eventSig) {
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == hToken.address
    );
    for (const rawEvent of rawEvents) {
      results.push(hToken.interface.decodeEventLog(eventName, rawEvent.data, rawEvent.topics));
    }
  }
  return results;
};

export const printVariableDebtTokenEvents = (
  variableDebtToken: VariableDebtToken,
  receipt: TransactionReceipt
) => {
  for (const eventSig of VARIABLE_DEBT_TOKEN_EVENTS) {
    const eventName = eventSig.sig.split('(')[0];
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == variableDebtToken.address
    );
    for (const rawEvent of rawEvents) {
      const rawParsed = variableDebtToken.interface.decodeEventLog(
        eventName,
        rawEvent.data,
        rawEvent.topics
      );
      const parsed: any[] = [];

      let i = 0;
      for (const arg of eventSig.args) {
        parsed[i] = ['value', 'balanceIncrease'].includes(arg)
          ? ethers.utils.formatEther(rawParsed[arg])
          : rawParsed[arg];
        i++;
      }

      console.log(`event ${eventName} ${parsed[0]} -> ${parsed[1]}: ${parsed.slice(2).join(' ')}`);
    }
  }
};

export const getVariableDebtTokenEvent = (
  variableDebtToken: VariableDebtToken,
  receipt: TransactionReceipt,
  eventName: string
) => {
  const eventSig = VARIABLE_DEBT_TOKEN_EVENTS.find((item) => item.sig.split('(')[0] === eventName);
  const results: utils.Result = [];
  if (eventSig) {
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == variableDebtToken.address
    );
    for (const rawEvent of rawEvents) {
      results.push(
        variableDebtToken.interface.decodeEventLog(eventName, rawEvent.data, rawEvent.topics)
      );
    }
  }
  return results;
};

export const printStableDebtTokenEvents = (
  stableDebtToken: StableDebtToken,
  receipt: TransactionReceipt
) => {
  for (const eventSig of STABLE_DEBT_TOKEN_EVENTS) {
    const eventName = eventSig.sig.split('(')[0];
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == stableDebtToken.address
    );
    for (const rawEvent of rawEvents) {
      const rawParsed = stableDebtToken.interface.decodeEventLog(
        eventName,
        rawEvent.data,
        rawEvent.topics
      );
      const parsed: any[] = [];

      let i = 0;
      for (const arg of eventSig.args) {
        parsed[i] = ['value', 'currentBalance', 'balanceIncrease'].includes(arg)
          ? ethers.utils.formatEther(rawParsed[arg])
          : rawParsed[arg];
        i++;
      }

      console.log(`event ${eventName} ${parsed[0]} -> ${parsed[1]}: ${parsed.slice(2).join(' ')}`);
    }
  }
};

export const getStableDebtTokenEvent = (
  stableDebtToken: StableDebtToken,
  receipt: TransactionReceipt,
  eventName: string
) => {
  const eventSig = STABLE_DEBT_TOKEN_EVENTS.find((item) => item.sig.split('(')[0] === eventName);
  const results: utils.Result = [];
  if (eventSig) {
    const encodedSig = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(eventSig.sig));
    const rawEvents = receipt.logs.filter(
      (log) => log.topics[0] === encodedSig && log.address == stableDebtToken.address
    );
    for (const rawEvent of rawEvents) {
      results.push(
        stableDebtToken.interface.decodeEventLog(eventName, rawEvent.data, rawEvent.topics)
      );
    }
  }
  return results;
};
