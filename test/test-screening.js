/**
 * Test the Pool Discovery API screening (no wallet required).
 * Run: node test/test-screening.js
 */

import { discoverPools, getPoolDetail } from "../tools/screening.js";

async function main() {
  console.log("=== Testing Pool Discovery API ===\n");

  // Test 1: Top pools
  console.log("Fetching top 10 pools (24h)...");
  const top = await discoverPools({ page_size: 10, timeframe: "24h", category: "top" });
  console.log(`Found ${top.total} total pools, showing ${top.pools.length}`);

  if (top.pools.length > 0) {
    const best = top.pools[0];
    console.log("\nTop pool:");
    console.log(`  Name: ${best.name}`);
    console.log(`  Pool: ${best.pool}`);
    console.log(`  Fee/active TVL ratio: ${best.fee_active_tvl_ratio ?? best.fee_tvl_ratio}`);
    console.log(`  Volume window: $${best.volume_window?.toLocaleString()}`);
    console.log(`  Active TVL: $${best.active_tvl?.toLocaleString()}`);
    console.log(`  Organic score: ${best.organic_score}`);
    console.log(`  Volatility: ${best.volatility}`);
    console.log(`  Active positions: ${best.active_pct}%`);
  }

  // Test 2: Trending pools
  console.log("\n\nFetching trending pools...");
  const trending = await discoverPools({ page_size: 5, timeframe: "1h", category: "trending" });
  console.log(`Found ${trending.pools.length} trending pools`);

  // Test 3: Pool detail (if we have a pool address)
  if (top.pools.length > 0) {
    const poolAddr = top.pools[0].pool;
    console.log(`\n\nFetching detail for ${poolAddr}...`);
    try {
      const detail = await getPoolDetail({ pool_address: poolAddr });
      console.log("Name:", detail.name);
      console.log("Pool address:", detail.pool_address);
      console.log("Fee/TVL ratio:", detail.fee_active_tvl_ratio);
      console.log("Volume 24h:", detail.volume);
      console.log("Active TVL:", detail.active_tvl);
      console.log("Volatility:", detail.volatility);
      console.log("Organic score (base):", detail.token_x?.organic_score);
      console.log("Holders:", detail.base_token_holders);
      console.log("Bin step:", detail.dlmm_params?.bin_step);
      console.log("Price trend:", detail.price_trend);
    } catch (err) {
      console.log("Pool detail error:", err.message);
    }
  }

  console.log("\n=== Screening tests complete ===");
}

main().catch(console.error);
