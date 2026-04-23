import fetch from 'node-fetch'; // if needed, but fetch is global in modern node

async function test_weather() {
    const loc = "Hong Kong";
    const url = `https://www.google.com/search?q=weather+${encodeURIComponent(loc)}&hl=en`;
    console.log("Fetching", url);
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
            "Accept-Language": "en-US,en;q=0.9"
        }
    });
    const html = await res.text();
    const tempMatch = html.match(/id="wob_tm"[^>]*>([^<]+)</);
    const condMatch = html.match(/id="wob_dc"[^>]*>([^<]+)</);
    const locMatch = html.match(/id="wob_loc"[^>]*>([^<]+)</);

    console.log("Temp:", tempMatch ? tempMatch[1] : null);
    console.log("Cond:", condMatch ? condMatch[1] : null);
    console.log("Loc:", locMatch ? locMatch[1] : null);
}
test_weather();
