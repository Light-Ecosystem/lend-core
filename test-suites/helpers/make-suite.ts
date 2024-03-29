import { Contract, Signer } from 'ethers';
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
  getHopeOracle,
  getACLManager,
  getFallbackOracle,
  getLendingGauge,
  getGaugeFactory,
  getLT,
  getMinter,
  getGaugeController,
  getVotingEscrow,
  getStakingHope,
} from '@hopelend/deploy/dist/helpers/contract-getters';
import { tEthereumAddress } from '../../helpers/types';
import {
  Pool,
  HopeLendProtocolDataProvider,
  MintableERC20,
  HToken,
  PoolConfigurator,
  PriceOracle,
  PoolAddressesProvider,
  PoolAddressesProviderRegistry,
  WETH9Mocked,
  HopeOracle,
  ACLManager,
  StableDebtToken,
  VariableDebtToken,
  LendingGauge,
  GaugeFactory,
} from '../../types';

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { waitForTx, evmSnapshot, evmRevert, getEthersSigners } from '@hopelend/deploy';

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
  hopeOracle: HopeOracle;
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
  lendingGauge: LendingGauge;
  daiLendingGauge: LendingGauge;
  gaugeFactory: GaugeFactory;
  lt: Contract;
  gaugeController: Contract;
  veLT: Contract;
  minter: Contract;
  stakingHOPE: Contract;
  hstHOPE: Contract;
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
  hopeOracle: {} as HopeOracle,
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
  lendingGauge: {} as LendingGauge,
  daiLendingGauge: {} as LendingGauge,
  gaugeFactory: {} as GaugeFactory,
  minter: {} as Contract,
  gaugeController: {} as Contract,
  lt: {} as Contract,
  veLT: {} as Contract,
  stakingHOPE: {} as Contract,
  hstHOPE: {} as Contract,
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
  testEnv.hopeOracle = await getHopeOracle();

  testEnv.lendingGauge = await getLendingGauge();
  testEnv.gaugeFactory = await getGaugeFactory();
  testEnv.gaugeController = await getGaugeController();
  testEnv.lt = await getLT();
  testEnv.minter = await getMinter();
  testEnv.veLT = await getVotingEscrow();

  testEnv.helpersContract = await getHopeLendProtocolDataProvider();

  const allTokens = await testEnv.helpersContract.getAllHTokens();

  const hDaiAddress = allTokens.find((hToken) => hToken.symbol.includes('hTestDAI'))?.tokenAddress;
  const hUsdcAddress = allTokens.find((hToken) =>
    hToken.symbol.includes('hTestUSDC')
  )?.tokenAddress;
  const hWEthAddress = allTokens.find((hToken) =>
    hToken.symbol.includes('hTestWETH')
  )?.tokenAddress;
  const hHopeAddress = allTokens.find((hToken) =>
    hToken.symbol.includes('hTestHOPE')
  )?.tokenAddress;
  const hstHOPEAddress = allTokens.find((hToken) =>
    hToken.symbol.includes('hTeststHOPE')
  )?.tokenAddress;

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
    throw 'Missing mandatory htokens';
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

  const mintableERC20Tokens = [testEnv.dai, testEnv.hope, testEnv.usdc, testEnv.weth];
  for (const token of mintableERC20Tokens) {
    for (const user of testEnv.users) {
      await waitForTx(await token.addMinter(user.address));
    }
  }

  const daiLendingGaugeAddress = await testEnv.gaugeFactory.lendingGauge(daiAddress);
  testEnv.daiLendingGauge = await getLendingGauge(daiLendingGaugeAddress);

  testEnv.stakingHOPE = await getStakingHope();
  testEnv.hstHOPE = await getHToken(hstHOPEAddress);

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
