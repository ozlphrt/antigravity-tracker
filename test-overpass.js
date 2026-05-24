const s = 37.0;
const w = 27.4;
const n = 37.05;
const e = 27.45;
const query = `
  [out:json][timeout:10];
  node["seamark:type"](${s},${w},${n},${e});
  out body;
`;

fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: query
})
.then(res => {
  console.log("Status:", res.status);
  return res.text();
})
.then(text => console.log("Response:", text.substring(0, 200)))
.catch(err => console.error("Error:", err));
