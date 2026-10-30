// Single source of truth for products. The site build renders pages from this
// file and the checkout function re-reads prices from it, so a price edited in
// the browser can never reach Stripe.
//
// available: false  -> shown as "Coming soon" with a notify-me form, never sold.

export const SITE = {
  name: "Press Box Kicks & Jerseys",
  url: "https://pressboxkicksjerseys.com",
  email: "orders@pressboxkicksjerseys.com",
  instagram: "pressboxkicks",
  legalName: "Sun Marketing Enterprises LLC",
  freeShippingMin: 150,
  flatShipping: 9.99,
  bundleMinItems: 3,
  bundlePercent: 10,
  dispatch: "Ships in 2–4 business days with tracking"
};

export const CATEGORIES = {
  "throwback-jerseys": { label: "Throwback Jerseys", path: "/throwback-jerseys/", h1: "Mitchell & Ness Throwback Jerseys", intro: "Legacy and Hardwood Classics throwbacks from the eras Philly and New York fans still argue about. Our Mitchell & Ness line is launching soon — join the list and we'll email you the day each jersey goes live." },
  "fitted-hats": { label: "59FIFTY Fitteds & Caps", path: "/fitted-hats/", h1: "New Era 59FIFTY Fitted Hats", intro: "World Series and Super Bowl side-patch 59FIFTY fitteds in sizes 7 1/8 to 7 5/8, plus our own 3D-puff Press Box cap." },
  "sneakers": { label: "Sneakers", path: "/sneakers/", h1: "Air Jordan & Nike Dunk Sneakers", intro: "Deadstock Air Jordan 1s, Jordan 4s and team-color Nike Dunks in men's US 9–12. Every pair is checked for authenticity before it ships." },
  "fan-gear": { label: "Hoodies, Sweaters & Slides", path: "/hoodies-sweaters/", h1: "Officially Licensed NFL & NBA Hoodies, Sweaters & Slides", intro: "FOCO licensed knit sweaters, heavyweight crewnecks, fleece hoodies and team slides — the easiest game-day gifts on the list." }
};

// Philly first, then New York, then everyone else (homepage and nav order).
export const TEAMS = {
  eagles: { name: "Philadelphia Eagles", short: "Eagles", color: "#004C54", league: "NFL" },
  "76ers": { name: "Philadelphia 76ers", short: "76ers", color: "#006BB6", league: "NBA" },
  phillies: { name: "Philadelphia Phillies", short: "Phillies", color: "#6F263D", league: "MLB" },
  giants: { name: "New York Giants", short: "Giants", color: "#0B2265", league: "NFL" },
  knicks: { name: "New York Knicks", short: "Knicks", color: "#F58426", league: "NBA" },
  yankees: { name: "New York Yankees", short: "Yankees", color: "#0C2340", league: "MLB" },
  ravens: { name: "Baltimore Ravens", short: "Ravens", color: "#241773", league: "NFL" },
  cowboys: { name: "Dallas Cowboys", short: "Cowboys", color: "#041E42", league: "NFL" },
  chiefs: { name: "Kansas City Chiefs", short: "Chiefs", color: "#E31837", league: "NFL" },
  lakers: { name: "Los Angeles Lakers", short: "Lakers", color: "#552583", league: "NBA" }
};

const JERSEY_SIZES = ["M", "L", "XL", "2XL"];
const HAT_SIZES = ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"];
const SHOE_SIZES = ["9", "9.5", "10", "10.5", "11", "11.5", "12"];

function mnJersey(id, teams, player, title, image, sku, blurb) {
  return {
    id, teams, title, image, sku, blurb,
    name: player,
    category: "throwback-jerseys",
    brand: "Mitchell & Ness",
    price: 109.99,
    sizeType: "jersey",
    sizes: JERSEY_SIZES,
    defaultSize: "XL",
    available: false
  };
}

export const PRODUCTS = [
  // ---- Fitted hats (live) ----
  {
    id: "eagles-kelly-green-59fifty",
    title: "New Era 59FIFTY Philadelphia Eagles Kelly Green Throwback Side-Patch Fitted Hat",
    name: "Eagles Kelly Green 59FIFTY",
    category: "fitted-hats", brand: "New Era", teams: ["eagles"],
    price: 41.99, sizeType: "hat", sizes: HAT_SIZES, defaultSize: "7 3/8",
    image: "/assets/prod-eagles-59fifty.png", sku: "NE-5950-PHI-KG", available: true,
    blurb: "The Kelly Green throwback crown with a grey under-visor and side patch — the cap that goes with every Cunningham-era fit."
  },
  {
    id: "phillies-1980-world-series-59fifty",
    title: "New Era 59FIFTY Philadelphia Phillies 1980 World Series Cooperstown Fitted Hat — Burgundy/Powder",
    name: "Phillies 1980 World Series 59FIFTY",
    category: "fitted-hats", brand: "New Era", teams: ["phillies"],
    price: 41.99, sizeType: "hat", sizes: HAT_SIZES, defaultSize: "7 3/8",
    image: "/assets/prod-phillies-59fifty.png", sku: "NE-5950-PHI-1980", available: true,
    blurb: "Cooperstown burgundy and powder blue with the 1980 World Series side patch."
  },
  {
    id: "yankees-1998-world-series-59fifty",
    title: "New Era 59FIFTY New York Yankees 1998 World Series Side-Patch Fitted Hat — Navy",
    name: "Yankees 1998 World Series 59FIFTY",
    category: "fitted-hats", brand: "New Era", teams: ["yankees"],
    price: 39.99, sizeType: "hat", sizes: HAT_SIZES, defaultSize: "7 3/8",
    image: "/assets/prod-yankees-59fifty.png", sku: "NE-5950-NYY-1998", available: true,
    blurb: "Classic navy Yankees fitted with the 1998 World Series side patch."
  },
  {
    id: "ravens-super-bowl-xxxv-59fifty",
    title: "New Era 59FIFTY Baltimore Ravens Super Bowl XXXV Side-Patch Fitted Hat — Purple",
    name: "Ravens Super Bowl XXXV 59FIFTY",
    category: "fitted-hats", brand: "New Era", teams: ["ravens"],
    price: 41.99, sizeType: "hat", sizes: HAT_SIZES, defaultSize: "7 3/8",
    image: "/assets/prod-ravens-59fifty.png", sku: "NE-5950-BAL-SB35", available: true,
    blurb: "Ravens purple with the Super Bowl XXXV side patch and grey under-visor."
  },
  {
    id: "chiefs-super-bowl-champions-59fifty",
    title: "New Era 59FIFTY Kansas City Chiefs Super Bowl Champions Side-Patch Fitted Hat",
    name: "Chiefs Super Bowl Champions 59FIFTY",
    category: "fitted-hats", brand: "New Era", teams: ["chiefs"],
    price: 39.99, sizeType: "hat", sizes: HAT_SIZES, defaultSize: "7 1/2",
    image: "/assets/prod-chiefs-59fifty.png", sku: "NE-5950-KC-LVIII", available: true,
    blurb: "Chiefs red fitted with a Super Bowl champions side patch."
  },
  {
    id: "press-box-3d-puff-cap",
    title: "Press Box 3D Puff Embroidered Logo Cap",
    name: "Press Box 3D Puff Cap",
    category: "fitted-hats", brand: "Press Box", teams: [],
    price: 34.99, sizeType: "hat", sizes: ["Snapback OSFA", ...HAT_SIZES], defaultSize: "Snapback OSFA",
    image: "/assets/prod-pressbox-custom-cap.png", sku: "PB-NE400-R112-3D", available: true,
    blurb: "Our own Press Box crest in raised 3D puff embroidery, on a structured snapback or fitted crown."
  },

  // ---- Sneakers (live) ----
  {
    id: "nike-dunk-low-philly-kelly-green",
    title: "Nike Dunk Low Retro 'Kelly Green & White' (DV0831-101)",
    name: "Nike Dunk Low Kelly Green",
    category: "sneakers", brand: "Nike", teams: ["eagles"],
    price: 109.99, sizeType: "sneaker", sizes: SHOE_SIZES, defaultSize: "10.5",
    image: "/assets/prod-dunk-philly.png", sku: "DV0831-101", available: true,
    blurb: "Two-tone green and white leather Dunks — a straight color match for Eagles throwback green."
  },
  {
    id: "nike-dunk-low-knicks-orange-royal",
    title: "Nike Dunk Low Retro 'Orange & Royal Blue' (DV0833-800)",
    name: "Nike Dunk Low Orange & Royal",
    category: "sneakers", brand: "Nike", teams: ["knicks"],
    price: 109.99, sizeType: "sneaker", sizes: SHOE_SIZES, defaultSize: "10.5",
    image: "/assets/prod-dunk-knicks.png", sku: "DV0833-800", available: true,
    blurb: "Orange and royal blue leather Dunks built for Knicks game nights."
  },
  {
    id: "air-jordan-4-midnight-navy",
    title: "Air Jordan 4 Retro 'Midnight Navy' (DH6927-140)",
    name: "Air Jordan 4 Midnight Navy",
    category: "sneakers", brand: "Jordan", teams: [],
    price: 219.99, sizeType: "sneaker", sizes: SHOE_SIZES, defaultSize: "10.5",
    image: "/assets/prod-aj4-navy.png", sku: "DH6927-140", available: true,
    blurb: "White leather with midnight navy and cement speckle. Deadstock, checked for authenticity before it ships."
  },
  {
    id: "air-jordan-1-high-og-lost-and-found",
    title: "Air Jordan 1 Retro High OG 'Chicago Lost & Found' (DZ5485-612)",
    name: "Air Jordan 1 Lost & Found",
    category: "sneakers", brand: "Jordan", teams: [],
    price: 239.99, sizeType: "sneaker", sizes: SHOE_SIZES, defaultSize: "10.5",
    image: "/assets/prod-aj1-chicago.png", sku: "DZ5485-612", available: true,
    blurb: "The vintage-styled Chicago colorway. Deadstock, checked for authenticity before it ships."
  },

  // ---- FOCO fan gear (live) ----
  {
    id: "foco-nfl-team-hoodie",
    title: "FOCO Officially Licensed NFL & NBA Team Fleece Pullover Hoodie",
    name: "FOCO Team Fleece Hoodie",
    category: "fan-gear", brand: "FOCO", teams: ["eagles", "76ers", "knicks", "ravens", "cowboys", "chiefs"],
    teamOptions: ["Eagles", "76ers", "Knicks", "Ravens", "Cowboys", "Chiefs"],
    price: 64.99, sizeType: "apparel", sizes: JERSEY_SIZES, defaultSize: "XL",
    image: "/assets/prod-foco-eagles-hoodie.png", sku: "FOCO-HD-NFL-NBA-26", available: true,
    blurb: "Midweight fleece pullover with officially licensed team graphics. Pick your team and size."
  },
  {
    id: "foco-nfl-knit-sweater",
    title: "FOCO Officially Licensed NFL Team Logo Jacquard Knit Sweater",
    name: "FOCO NFL Knit Sweater",
    category: "fan-gear", brand: "FOCO", teams: ["eagles", "giants", "ravens", "cowboys", "chiefs"],
    teamOptions: ["Eagles", "Giants", "Ravens", "Cowboys", "Chiefs"],
    price: 59.99, sizeType: "apparel", sizes: ["S", "M", "L", "XL", "2XL", "3XL"], defaultSize: "XL",
    image: "/assets/prod-foco-nfl-knit-sweater.png", sku: "FOCO-SWT-NFL-KNIT-26", available: true,
    blurb: "Jacquard-knit holiday sweater with your team's logo worked into the pattern."
  },
  {
    id: "foco-nfl-vintage-crewneck",
    title: "FOCO Officially Licensed NFL Vintage Block Wordmark Heavyweight Crewneck",
    name: "FOCO NFL Vintage Crewneck",
    category: "fan-gear", brand: "FOCO", teams: ["eagles", "giants", "ravens", "cowboys", "chiefs"],
    teamOptions: ["Eagles", "Giants", "Ravens", "Cowboys", "Chiefs"],
    price: 54.99, sizeType: "apparel", sizes: ["S", "M", "L", "XL", "2XL"], defaultSize: "XL",
    image: "/assets/prod-foco-nfl-crewneck.png", sku: "FOCO-SWT-NFL-CREW-26", available: true,
    blurb: "Heavyweight crewneck with a vintage block team wordmark."
  },
  {
    id: "foco-ravens-light-up-knit-sweater",
    title: "FOCO Officially Licensed Baltimore Ravens Light-Up Snowfall Knit Sweater",
    name: "FOCO Ravens Light-Up Sweater",
    category: "fan-gear", brand: "FOCO", teams: ["ravens"],
    price: 59.99, sizeType: "apparel", sizes: ["S", "M", "L", "XL", "2XL", "3XL"], defaultSize: "XL",
    image: "/assets/prod-foco-ravens-knit-sweater.png", sku: "FOCO-SWT-BAL-KNIT-26", available: true,
    blurb: "Busy-block snowfall knit with built-in lights — the holiday-party sweater for Ravens fans."
  },
  {
    id: "foco-team-slides",
    title: "FOCO Officially Licensed NFL & NBA Team Wordmark Slides",
    name: "FOCO Team Slides",
    category: "fan-gear", brand: "FOCO", teams: ["eagles", "giants", "knicks", "ravens", "cowboys", "chiefs"],
    teamOptions: ["Eagles", "Giants", "Knicks", "Ravens", "Cowboys", "Chiefs"],
    price: 36.99, sizeType: "slides", sizes: ["M (8-9)", "L (10-11)", "XL (12-13)"], defaultSize: "L (10-11)",
    image: "/assets/prod-foco-team-slides.png", sku: "FOCO-SLD-NFL-NBA-26", available: true,
    blurb: "Cushioned team wordmark slides — an easy stocking stuffer."
  },

  // ---- Mitchell & Ness throwbacks (coming soon) ----
  mnJersey("eagles-randall-cunningham-1990-kelly-green-jersey", ["eagles"], "Randall Cunningham #12 Eagles Throwback",
    "Mitchell & Ness Randall Cunningham #12 Philadelphia Eagles 1990 Kelly Green Legacy Throwback Jersey",
    "/assets/prod-eagles-cunningham.png", "MN-NFL-PHI-1990-12",
    "Randall Cunningham in the 1990 Kelly Green — the definitive Eagles throwback."),
  mnJersey("eagles-reggie-white-1992-kelly-green-jersey", ["eagles"], "Reggie White #92 Eagles Throwback",
    "Mitchell & Ness Reggie White #92 Philadelphia Eagles 1992 Kelly Green Legacy Throwback Jersey",
    "/assets/prod-eagles-reggie-white.png", "MN-NFL-PHI-1992-92",
    "The Minister of Defense in 1992 Kelly Green."),
  mnJersey("76ers-allen-iverson-1996-black-swingman-jersey", ["76ers"], "Allen Iverson #3 Sixers Throwback",
    "Mitchell & Ness Allen Iverson #3 Philadelphia 76ers 1996-97 Hardwood Classics Black Swingman Jersey",
    "/assets/prod-sixers-iverson.png", "MN-NBA-PHI-1996-03",
    "Iverson's 1996-97 rookie-season black Sixers Swingman."),
  mnJersey("giants-lawrence-taylor-1986-jersey", ["giants"], "Lawrence Taylor #56 Giants Throwback",
    "Mitchell & Ness Lawrence Taylor #56 New York Giants 1986 Legacy Throwback Jersey",
    "/assets/prod-giants-taylor.png", "MN-NFL-NYG-1986-56",
    "LT in the 1986 championship-season blue."),
  mnJersey("knicks-patrick-ewing-1991-swingman-jersey", ["knicks"], "Patrick Ewing #33 Knicks Throwback",
    "Mitchell & Ness Patrick Ewing #33 New York Knicks 1991-92 Hardwood Classics Swingman Jersey",
    "/assets/prod-knicks-ewing.png", "MN-NBA-NYK-1991-33",
    "Ewing's 1991-92 Knicks Swingman in royal blue."),
  mnJersey("ravens-ray-lewis-2000-jersey", ["ravens"], "Ray Lewis #52 Ravens Throwback",
    "Mitchell & Ness Ray Lewis #52 Baltimore Ravens 2000 Legacy Throwback Jersey — Purple",
    "/assets/prod-ravens-ray-lewis.png", "MN-NFL-BAL-2000-52",
    "Ray Lewis in 2000 Ravens purple."),
  mnJersey("ravens-ed-reed-2004-jersey", ["ravens"], "Ed Reed #20 Ravens Throwback",
    "Mitchell & Ness Ed Reed #20 Baltimore Ravens 2004 Legacy Throwback Jersey",
    "/assets/prod-ravens-ed-reed.png", "MN-NFL-BAL-2004-20",
    "Ed Reed's 2004 Ravens throwback."),
  mnJersey("cowboys-deion-sanders-1995-jersey", ["cowboys"], "Deion Sanders #21 Cowboys Throwback",
    "Mitchell & Ness Deion Sanders #21 Dallas Cowboys 1995 Legacy Throwback Jersey — Navy",
    "/assets/prod-cowboys-sanders.png", "MN-NFL-DAL-1995-21",
    "Prime Time in 1995 Cowboys navy."),
  mnJersey("lakers-kobe-bryant-1996-swingman-jersey", ["lakers"], "Kobe Bryant #8 Lakers Throwback",
    "Mitchell & Ness Kobe Bryant #8 Los Angeles Lakers 1996-97 Hardwood Classics Swingman Jersey — Gold",
    "/assets/prod-lakers-kobe.png", "MN-NBA-LAL-1996-08",
    "Kobe's 1996-97 rookie-season gold Swingman.")
];

// Search-demand landing pages (Google Ads US data, Oct 2026). Each one gets
// its own URL so ads and organic search land on a page that matches the query.
export const LANDING_PAGES = [
  {
    path: "/kelly-green-eagles-jersey/",
    h1: "Kelly Green Eagles Jerseys",
    title: "Kelly Green Eagles Jersey — Cunningham & Reggie White Throwbacks",
    description: "Kelly Green Eagles throwback jerseys from Mitchell & Ness (Randall Cunningham #12, Reggie White #92) — join the launch list — plus Kelly Green 59FIFTY fitteds and matching Dunks in stock now.",
    intro: "The Eagles' Kelly Green era is back on game days, and these are the throwbacks everyone wants. Our Mitchell & Ness Kelly Green jerseys are launching soon — leave your email and we'll tell you first. The Kelly Green fitted and matching green Dunks ship now.",
    match: p => p.teams.includes("eagles")
  },
  {
    path: "/allen-iverson-jersey/",
    h1: "Allen Iverson Jerseys",
    title: "Allen Iverson Jersey — 1996-97 Sixers Hardwood Classics Throwback",
    description: "Allen Iverson #3 Mitchell & Ness Hardwood Classics Sixers throwback — join the launch list — plus Sixers hoodies, Phillies fitteds and Jordan 1s that ship now.",
    intro: "The 1996-97 Iverson rookie Swingman is the jersey that defined an era of Philly basketball. It's launching soon in our Mitchell & Ness line — get on the list. Sixers gear and Jordans that complete the fit are in stock.",
    match: p => p.teams.includes("76ers") || p.id === "air-jordan-1-high-og-lost-and-found"
  },
  {
    path: "/eagles-kelly-green-hat/",
    h1: "Eagles Kelly Green Hats",
    title: "Eagles Kelly Green Hat — New Era 59FIFTY Throwback Fitted",
    description: "New Era 59FIFTY Philadelphia Eagles Kelly Green throwback fitted hat with side patch, sizes 7 1/8–7 5/8. Free shipping over $150.",
    intro: "The Kelly Green Eagles 59FIFTY fitted with a grey under-visor and throwback side patch, in sizes 7 1/8 to 7 5/8.",
    match: p => p.teams.includes("eagles") && p.category !== "throwback-jerseys"
  }
];

export function findProduct(id) {
  return PRODUCTS.find(p => p.id === id);
}
