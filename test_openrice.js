import { getTopRestaurants } from './openrice_service.js';

async function runTests() {
    console.log("=== Testing OpenRice API Service ===\n");

    console.log("Test 1: Japanese in Central");
    const res1 = await getTopRestaurants("Japanese", "Central", 3);
    console.log(JSON.stringify(res1, null, 2));
    console.log("\n-----------------------------------\n");

    console.log("Test 2: Thai in Causeway Bay");
    const res2 = await getTopRestaurants("Thai", "Causeway Bay", 2);
    console.log(JSON.stringify(res2, null, 2));
    console.log("\n-----------------------------------\n");

    console.log("Test 3: Unmatched Location (Should search whole HK)");
    const res3 = await getTopRestaurants("Hot Pot", "Atlantis", 2);
    console.log(JSON.stringify(res3, null, 2));
}

runTests();
