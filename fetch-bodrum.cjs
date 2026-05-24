const fs = require('fs');

const query = `
  [out:json][timeout:25];
  node["seamark:type"](36.90,27.15,37.15,27.55);
  out body;
`;

async function fetchSeamarks() {
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'data=' + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error('Failed: ' + res.status);
    const data = await res.json();
    fs.writeFileSync('public/bodrum-seamarks.json', JSON.stringify(data));
    console.log(`Saved ${data.elements.length} seamarks to public/bodrum-seamarks.json`);
  } catch (err) {
    console.error(err);
  }
}

fetchSeamarks();
