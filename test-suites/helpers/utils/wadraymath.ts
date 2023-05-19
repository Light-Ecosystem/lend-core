import { BigNumber } from '@ethersproject/bignumber';
import { BigNumberish } from 'ethers';

import {
  RAY,
  WAD,
  HALF_RAY,
  HALF_WAD,
  WAD_RAY_RATIO,
  HALF_PERCENTAGE,
  PERCENTAGE_FACTOR,
} from '../../../helpers/constants';

declare module '@ethersproject/bignumber' {
  interface BigNumber {
    ray: () => BigNumber;
    wad: () => BigNumber;
    halfRay: () => BigNumber;
    halfWad: () => BigNumber;
    halfPercentage: () => BigNumber;
    percentageFactor: () => BigNumber;
    wadMul: (a: BigNumber) => BigNumber;
    wadDiv: (a: BigNumber) => BigNumber;
    rayMul: (a: BigNumber) => BigNumber;
    rayDiv: (a: BigNumber) => BigNumber;
    percentMul: (a: BigNumberish) => BigNumber;
    percentDiv: (a: BigNumberish) => BigNumber;
    rayToWad: () => BigNumber;
    wadToRay: () => BigNumber;
    negated: () => BigNumber;
  }
}

BigNumber.prototype.ray = (): BigNumber => BigNumber.from(RAY);
function ray (): BigNumber {
  return BigNumber.from(RAY);
};

BigNumber.prototype.wad = (): BigNumber => BigNumber.from(WAD);
function wad (): BigNumber {
  return BigNumber.from(WAD);
};

BigNumber.prototype.halfRay = (): BigNumber => BigNumber.from(HALF_RAY);
function halfRay (): BigNumber {
  return BigNumber.from(HALF_RAY);
};

BigNumber.prototype.halfWad = (): BigNumber => BigNumber.from(HALF_WAD);
function halfWad (): BigNumber {
  return BigNumber.from(HALF_WAD);
};

BigNumber.prototype.halfPercentage = (): BigNumber => BigNumber.from(HALF_PERCENTAGE);
function halfPercentage (): BigNumber {
  return BigNumber.from(HALF_PERCENTAGE);
};

BigNumber.prototype.percentageFactor = (): BigNumber => BigNumber.from(PERCENTAGE_FACTOR);
function percentageFactor (): BigNumber {
  return BigNumber.from(PERCENTAGE_FACTOR);
};

BigNumber.prototype.wadMul = function (other: BigNumber): BigNumber {
  return this.halfWad().add(this.mul(other)).div(this.wad());
};

function wadMul (receiver: BigNumber, other: BigNumber): BigNumber {
  return halfWad().add(receiver.mul(other)).div(wad());
};

BigNumber.prototype.wadDiv = function (other: BigNumber): BigNumber {
  const halfOther = other.div(2);
  return halfOther.add(this.mul(this.wad())).div(other);
};

function wadDiv (receiver: BigNumber, other: BigNumber): BigNumber {
  const halfOther = other.div(2);
  return halfOther.add(receiver.mul(wad())).div(other);
};

BigNumber.prototype.rayMul = function (other: BigNumber): BigNumber {
  return this.halfRay().add(this.mul(other)).div(this.ray());
};

function rayMul (receiver: BigNumber, other: BigNumber): BigNumber {
  return halfRay().add(receiver.mul(other)).div(ray());
}

BigNumber.prototype.rayDiv = function (other: BigNumber): BigNumber {
  const halfOther = other.div(2);
  return halfOther.add(this.mul(this.ray())).div(other);
};

function rayDiv (receiver: BigNumber, other: BigNumber): BigNumber {
  const halfOther = other.div(2);
  return halfOther.add(receiver.mul(ray())).div(other);
}

BigNumber.prototype.percentMul = function (bps: BigNumberish): BigNumber {
  return this.halfPercentage().add(this.mul(bps)).div(PERCENTAGE_FACTOR);
};

function percentMul (receiver: BigNumber, bps: BigNumberish): BigNumber {
  return halfPercentage().add(receiver.mul(bps)).div(PERCENTAGE_FACTOR);
};

BigNumber.prototype.percentDiv = function (bps: BigNumberish): BigNumber {
  const halfBps = BigNumber.from(bps).div(2);
  return halfBps.add(this.mul(PERCENTAGE_FACTOR)).div(bps);
};

function percentDiv (receiver: BigNumber, bps: BigNumberish): BigNumber {
  const halfBps = BigNumber.from(bps).div(2);
  return halfBps.add(receiver.mul(PERCENTAGE_FACTOR)).div(bps);
};

BigNumber.prototype.rayToWad = function (): BigNumber {
  const halfRatio = BigNumber.from(WAD_RAY_RATIO).div(2);
  return halfRatio.add(this).div(WAD_RAY_RATIO);
};

function rayToWad (receiver: BigNumber): BigNumber {
  const halfRatio = BigNumber.from(WAD_RAY_RATIO).div(2);
  return halfRatio.add(receiver).div(WAD_RAY_RATIO);
};

BigNumber.prototype.wadToRay = function (): BigNumber {
  return this.mul(WAD_RAY_RATIO);
};

function wadToRay (receiver: BigNumber): BigNumber {
  return receiver.mul(WAD_RAY_RATIO);
}

BigNumber.prototype.negated = function (): BigNumber {
  return this.mul(-1);
};

function negated (receiver: BigNumber): BigNumber {
  return receiver.mul(-1);
};

export {
  ray,
  wad,
  halfRay,
  halfWad,
  halfPercentage,
  percentageFactor,
  wadMul,
  wadDiv,
  rayMul,
  rayDiv,
  percentMul,
  percentDiv,
  rayToWad,
  wadToRay,
  negated,
};