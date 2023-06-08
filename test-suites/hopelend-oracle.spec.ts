import { MOCK_CHAINLINK_AGGREGATORS_PRICES } from 'lend-deploy/dist/helpers/constants';
import { expect } from 'chai';
import { oneEther, ONE_ADDRESS, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  deployMintableERC20,
  deployMockAggregator,
  evmRevert,
  evmSnapshot,
  MintableERC20,
  MockAggregator,
} from 'lend-deploy';
import { log } from 'console';

makeSuite('HopeOracle', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  let mockToken: MintableERC20;
  let mockAggregator: MockAggregator;
  let assetPrice: string;

  before(async () => {
    const { deployer } = testEnv;
    mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18', deployer.address]);
    assetPrice = MOCK_CHAINLINK_AGGREGATORS_PRICES.ETH;
    mockAggregator = await deployMockAggregator(assetPrice);
  });

  it('Owner set a new asset source', async () => {
    const { poolAdmin, hopeOracle } = testEnv;
    console.log('hopeOracle.address', hopeOracle.address);

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);
    const priorSourcePrice = await hopeOracle.getAssetPrice(mockToken.address);
    const priorSourcesPrices = (await hopeOracle.getAssetsPrices([mockToken.address])).map((x) =>
      x.toString()
    );
    expect(priorSourcePrice).to.equal('0');
    expect(priorSourcesPrices).to.eql(['0']);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    const sourcesPrices = await (
      await hopeOracle.getAssetsPrices([mockToken.address])
    ).map((x) => x.toString());
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);
    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
    expect(sourcesPrices).to.eql([assetPrice]);
  });

  it('Owner update an existing asset source', async () => {
    const { poolAdmin, hopeOracle, dai } = testEnv;

    // DAI token has already a source
    const daiSource = await hopeOracle.getSourceOfAsset(dai.address);
    expect(daiSource).to.be.not.eq(ZERO_ADDRESS);

    // Update DAI source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([dai.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(dai.address, mockAggregator.address);

    expect(await hopeOracle.getSourceOfAsset(dai.address)).to.be.eq(mockAggregator.address);
    expect(await hopeOracle.getAssetPrice(dai.address)).to.be.eq(assetPrice);
  });

  it('Owner tries to set a new asset source with wrong input params (revert expected)', async () => {
    const { poolAdmin, hopeOracle } = testEnv;

    await expect(
      hopeOracle.connect(poolAdmin.signer).setAssetSources([mockToken.address], [])
    ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_PARAMS_LENGTH);
  });

  it('Get price of BASE_CURRENCY asset', async () => {
    const { hopeOracle } = testEnv;

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await hopeOracle.getAssetPrice(await hopeOracle.BASE_CURRENCY())).to.be.eq(
      await hopeOracle.BASE_CURRENCY_UNIT()
    );
  });

  it('A non-owner user tries to set a new asset source (revert expected)', async () => {
    const { users, hopeOracle } = testEnv;
    const user = users[0];

    const { CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN } = ProtocolErrors;

    await expect(
      hopeOracle.connect(user.signer).setAssetSources([mockToken.address], [mockAggregator.address])
    ).to.be.revertedWith(CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN);
  });

  it('Get price of BASE_CURRENCY asset with registered asset source for its address', async () => {
    const { poolAdmin, hopeOracle, weth } = testEnv;

    // Add asset source for BASE_CURRENCY address
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([weth.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(weth.address, mockAggregator.address);

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await hopeOracle.getAssetPrice(weth.address)).to.be.eq(
      MOCK_CHAINLINK_AGGREGATORS_PRICES.WETH
    );
  });

  it('Get price of asset with no asset source', async () => {
    const { hopeOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Returns 0 price
    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with 0 price and no fallback price', async () => {
    const { poolAdmin, hopeOracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with 0 price but non-zero fallback price', async () => {
    const { poolAdmin, hopeOracle, oracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with failover activated and no fallback price', async () => {
    const { poolAdmin, hopeOracle } = testEnv;
    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);
    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);

    // activate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).activateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverActivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with failover activated and fallback price', async () => {
    const { poolAdmin, hopeOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);

    // activate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).activateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverActivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with failover deactivated and no fallback price', async () => {
    const { poolAdmin, hopeOracle } = testEnv;

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);

    // activate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).activateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverActivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(0);

    // deactivate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).deactivateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverDeactivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
  });

  it('Get price of asset with failover deactivated and fallback price', async () => {
    const { poolAdmin, hopeOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    expect(await hopeOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);

    // activate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).activateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverActivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);

    // deactivate Failover
    expect(await hopeOracle.connect(poolAdmin.signer).deactivateFailover(mockToken.address))
      .to.emit(hopeOracle, 'FailoverDeactivated')
      .withArgs(mockToken.address);

    expect(await hopeOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
  });

  it('Owner update the FallbackOracle', async () => {
    const { poolAdmin, hopeOracle, oracle } = testEnv;

    expect(await hopeOracle.getFallbackOracle()).to.be.eq(oracle.address);

    // Update oracle source
    expect(await hopeOracle.connect(poolAdmin.signer).setFallbackOracle(ONE_ADDRESS))
      .to.emit(hopeOracle, 'FallbackOracleUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await hopeOracle.getFallbackOracle()).to.be.eq(ONE_ADDRESS);
  });
});
