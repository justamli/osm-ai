import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPINGS_PATH = path.join(__dirname, 'public', 'config', 'openrice_mappings.json');

// Memory cache for mappings
let mappingsCache = null;

async function getMappings() {
    if (!mappingsCache) {
        try {
            const data = await fs.readFile(MAPPINGS_PATH, 'utf8');
            mappingsCache = JSON.parse(data);
        } catch (error) {
            console.error("Failed to load OpenRice mappings:", error);
            return { districts: [], cuisines: [] };
        }
    }
    return mappingsCache;
}

/**
 * Clean search key (e.g., "districtId=1003" -> "1003")
 */
function extractId(searchKey) {
    if (!searchKey) return null;
    const parts = searchKey.split('=');
    return parts.length > 1 ? parts[1] : parts[0];
}

/**
 * Simple text matching to find district and cuisine IDs
 */
async function resolveKeywords(foodType, location) {
    const mappings = await getMappings();

    let districtId = null;
    let districtName = null;
    let cuisineId = null;
    let cuisineName = null;

    // Resolve Location -> District
    if (location) {
        const locLower = location.toLowerCase();
        // Exact match first, then partial match
        const found = mappings.districts.find(d => d.name.toLowerCase() === locLower) ||
            mappings.districts.find(d => d.name.toLowerCase().includes(locLower) || locLower.includes(d.name.toLowerCase()));

        if (found) {
            districtId = extractId(found.searchKey);
            districtName = found.name;
        }
    }

    // Resolve Food Type -> Cuisine
    if (foodType) {
        const foodLower = foodType.toLowerCase();
        const found = mappings.cuisines.find(c => c.name.toLowerCase() === foodLower) ||
            mappings.cuisines.find(c => c.name.toLowerCase().includes(foodLower) || foodLower.includes(c.name.toLowerCase()));

        if (found) {
            cuisineId = extractId(found.searchKey);
            cuisineName = found.name;
        }
    }

    return { districtId, districtName, cuisineId, cuisineName };
}

/**
 * Main API function to get top restaurants
 */
export async function getTopRestaurants(foodType, location, rows = 10) {
    const resolution = await resolveKeywords(foodType, location);

    // Base URL
    let url = `https://www.openrice.com/api/pois?uiLang=en&uiCity=hongkong&page=1&sortBy=Default&rows=${rows}`;

    // Apply filters if found
    if (resolution.districtId) {
        url += `&districtId=${resolution.districtId}`;
    }
    if (resolution.cuisineId) {
        url += `&cuisineId=${resolution.cuisineId}`;
    }

    // Fake User-Agent to avoid immediate blocking
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`OpenRice API Error: ${response.status}`);
        }

        const data = await response.json();

        // Safety check for path changes in OpenRice API
        const results = data?.searchResult?.paginationResult?.results || [];

        console.log("------------>" + results.length);

        //console.log(JSON.stringify(results));

        const formattedResults = results.map(r => ({
            name: r.nameUI || 'Unknown',
            rating: r.score || 'N/A',
            price: r.priceUI || 'Unknown Price',
            district: r.district?.name || 'Unknown District',
            bookmarks: r.bookmarkedUserCount || 0,
            reviews: r.reviewCount || 0,
            addressOtherLang: r.addressOtherLang || r.plainAddress,
            phones: r.phones,
            url: r.urlUI ? `https://www.openrice.com${r.urlUI}` : null
        }));

        return {
            status: 'success',
            meta: {
                requestedFood: foodType,
                requestedLocation: location,
                resolvedDistrict: resolution.districtName || 'All Hong Kong',
                resolvedCuisine: resolution.cuisineName || 'All Cuisines',
                totalFound: data?.searchResult?.paginationResult?.count || 0
            },
            restaurants: formattedResults
        };

    } catch (error) {
        console.error("OpenRice Scraper API Error:", error);
        return {
            status: 'error',
            message: error.message
        };
    }
}
