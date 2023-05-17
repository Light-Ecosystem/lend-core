import { Signer } from 'ethers';
import {
  getPool,
  getPoolAddressesProvider,
  getHopeLendProtocolDataProvider,
  getHToken,
  getMintableERC20,
  getPoolConfiguratorProxy,
  getPoolAddressesProviderRegistry,
  getWETHMocked,
  getVariableDebtToken,
  getStableDebtToken,
  getHopeLendOracle,
  getACLManager,
  getFallbackOracle,
} from 'lend-deploy/dist/helpers/contract-getters';
import { tEthereumAddress } from '../../helpers/types';
import { Pool } from '../../types/Pool';
import { HopeLendProtocolDataProvider } from '../../types/HopeLendProtocolDataProvider';
import { MintableERC20 } from '../../types/MintableERC20';
import { HToken } from '../../types/HToken';
import { PoolConfigurator } from '../../types/PoolConfigurator';

import { PriceOracle } from '../../types/PriceOracle';
import { PoolAddressesProvider } from '../../types/PoolAddressesProvider';
import { PoolAddressesProviderRegistry } from '../../types/PoolAddressesProviderRegistry';
import { WETH9Mocked } from '../../types/WETH9Mocked';
import { HopeLendOracle, ACLManager, StableDebtToken, VariableDebtToken } from '../../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { waitForTx, evmSnapshot, evmRevert, getEthersSigners } from 'lend-deploy';

declare var hre: HardhatRuntimeEnvironment;

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}
export interface TestEnv {
  deployer: SignerWithAddress;
  poolAdmin: SignerWithAddress;
  emergencyAdmin: SignerWithAddress;
  riskAdmin: SignerWithAddress;
  users: SignerWithAddress[];
  pool: Pool;
  configurator: PoolConfigurator;
  oracle: PriceOracle;
  hopeLendOracle: HopeLendOracle;
  helpersContract: HopeLendProtocolDataProvider;
  weth: WETH9Mocked;
  hWETH: HToken;
  dai: MintableERC20;
  hDai: HToken;
  hHope: HToken;
  variableDebtDai: VariableDebtToken;
  stableDebtDai: StableDebtToken;
  hUsdc: HToken;
  usdc: MintableERC20;
  hope: MintableERC20;
  addressesProvider: PoolAddressesProvider;
  registry: PoolAddressesProviderRegistry;
  aclManager: ACLManager;
}

let HardhatSnapshotId: string = '0x1';
const setHardhatSnapshotId = (id: string) => {
  HardhatSnapshotId = id;
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  poolAdmin: {} as SignerWithAddress,
  emergencyAdmin: {} as SignerWithAddress,
  riskAdmin: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  pool: {} as Pool,
  configurator: {} as PoolConfigurator,
  helpersContract: {} as HopeLendProtocolDataProvider,
  oracle: {} as PriceOracle,
  hopeLendOracle: {} as HopeLendOracle,
  weth: {} as WETH9Mocked,
  hWETH: {} as HToken,
  dai: {} as MintableERC20,
  hDai: {} as HToken,
  variableDebtDai: {} as VariableDebtToken,
  stableDebtDai: {} as StableDebtToken,
  hUsdc: {} as HToken,
  usdc: {} as MintableERC20,
  hope: {} as MintableERC20,
  addressesProvider: {} as PoolAddressesProvider,
  registry: {} as PoolAddressesProviderRegistry,
  aclManager: {} as ACLManager,
} as TestEnv;

export async function initializeMakeSuite() {
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }
  testEnv.deployer = deployer;
  testEnv.poolAdmin = deployer;
  testEnv.emergencyAdmin = testEnv.users[1];
  testEnv.riskAdmin = testEnv.users[2];
  testEnv.pool = await getPool();
  testEnv.configurator = await getPoolConfiguratorProxy();

  testEnv.addressesProvider = await getPoolAddressesProvider();

  testEnv.registry = await getPoolAddressesProviderRegistry();
  testEnv.aclManager = await getACLManager();

  testEnv.oracle = await getFallbackOracle();
  testEnv.hopeLendOracle = await getHopeLendOracle();

  testEnv.helpersContract = await getHopeLendProtocolDataProvider();

  const allTokens = await testEnv.helpersContract.getAllHTokens();
  const hDaiAddress = allTokens.find((hToken) => hToken.symbol.includes('DAI'))?.tokenAddress;
  const hUsdcAddress = allTokens.find((hToken) => hToken.symbol.includes('USDC'))?.tokenAddress;
  const hWEthAddress = allTokens.find((hToken) => hToken.symbol.includes('WETH'))?.tokenAddress;
  const hHopeAddress = allTokens.find((hToken) => hToken.symbol.includes('HOPE'))?.tokenAddress;

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();

  const daiAddress = reservesTokens.find((token) => token.symbol === 'DAI')?.tokenAddress;
  const {
    variableDebtTokenAddress: variableDebtDaiAddress,
    stableDebtTokenAddress: stableDebtDaiAddress,
  } = await testEnv.helpersContract.getReserveTokensAddresses(daiAddress || '');
  const usdcAddress = reservesTokens.find((token) => token.symbol === 'USDC')?.tokenAddress;
  const hopeAddress = reservesTokens.find((token) => token.symbol === 'HOPE')?.tokenAddress;
  const wethAddress = reservesTokens.find((token) => token.symbol === 'WETH')?.tokenAddress;

  if (!hDaiAddress || !hWEthAddress) {
    throw 'Missing mandatory atokens';
  }
  if (!daiAddress || !usdcAddress || !hopeAddress || !wethAddress) {
    throw 'Missing mandatory tokens';
  }

  testEnv.hDai = await getHToken(hDaiAddress);
  testEnv.variableDebtDai = await getVariableDebtToken(variableDebtDaiAddress);
  testEnv.stableDebtDai = await getStableDebtToken(stableDebtDaiAddress);
  testEnv.hUsdc = await getHToken(hUsdcAddress);
  testEnv.hWETH = await getHToken(hWEthAddress);
  testEnv.hHope = await getHToken(hHopeAddress);

  testEnv.dai = await getMintableERC20(daiAddress);
  testEnv.hope = await getMintableERC20(hopeAddress);
  testEnv.usdc = await getMintableERC20(usdcAddress);
  testEnv.weth = await getWETHMocked(wethAddress);

  // Setup admins
  await waitForTx(await testEnv.aclManager.addRiskAdmin(testEnv.riskAdmin.address));
  await waitForTx(await testEnv.aclManager.addEmergencyAdmin(testEnv.emergencyAdmin.address));
}

const setSnapshot = async () => {
  if (usingTenderly()) {
    setHardhatSnapshotId((await hre.tenderlyNetwork.getHead()) || '0x1');
    return;
  }
  setHardhatSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (usingTenderly()) {
    await hre.tenderlyNetwork.setHead(HardhatSnapshotId);
    return;
  }
  await evmRevert(HardhatSnapshotId);
};

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      await setSnapshot();
    });
    tests(testEnv);
    after(async () => {
      await revertHead();
    });
  });
}
