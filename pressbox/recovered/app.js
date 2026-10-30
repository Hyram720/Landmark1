const PRODUCTS = [
  // LEAD CATEGORY 1: MITCHELL & NESS THROWBACKS (Eagles Cunningham #12, Reggie White #92, 76ers Iverson #3, Giants LT #56, Knicks Ewing #33, Cowboys Deion #21, Lakers Kobe #8)
  {
    id: "ravens-ray-lewis-2000",
    title: "Mitchell & Ness Baltimore Ravens Ray Lewis #52 2000 Super Bowl XXXV Legacy Throwback Jersey — Purple",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Ravens",
    teamTags: ["Ravens"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • SB XXXV MVP Grail",
    badge: "Official NFL Hologram Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-ravens-ray-lewis.png",
    sku: "MN-NFL-BAL-2000-52",
    hologram: "Official NFL Shield Metallic Serial Hologram • Sourced via Casey's Distributing / Verified Closeout",
    fulfillmentMode: "Dropship / Verified Wholesale (2–4 Business Days)"
  },
  {
    id: "ravens-ed-reed-2004",
    title: "Mitchell & Ness Baltimore Ravens Ed Reed #20 2004 DPOY Legacy Throwback Jersey — Black/Purple",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Ravens",
    teamTags: ["Ravens"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • Hall of Fame #20",
    badge: "Stitched Tackle Twill • NFL Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-ravens-ed-reed.png",
    sku: "MN-NFL-BAL-2004-20",
    hologram: "Official NFL Shield Metallic Serial Hologram • Sourced via Casey's Distributing / Verified Closeout",
    fulfillmentMode: "Dropship / Verified Wholesale (2–4 Business Days)"
  },
  {
    id: "foco-ravens-knit-sweater",
    title: "FOCO Official Baltimore Ravens Busy Block Snowfall & Light-Up Jacquard Knit Sweater",
    category: "nfl-sweaters",
    categoryLabel: "NFL Team Sweaters (Dropship)",
    brand: "FOCO / Casey's Distributing • Direct Dropship",
    team: "Ravens",
    teamTags: ["Ravens"],
    price: 59.99,
    msrp: 74.99,
    urgency: "2-4 Day US Dropship • Ravens Flock",
    badge: "Official FOCO Ravens Knit • Dropship",
    sizeType: "jersey",
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    defaultSize: "XL",
    image: "/assets/prod-foco-ravens-knit-sweater.png",
    sku: "FOCO-SWT-BAL-KNIT-26",
    hologram: "Official FOCO Forever Collectibles NFL Hologram Hangtag • Dropship via Casey's Distributing (Omaha, NE / Columbus, OH)",
    fulfillmentMode: "Dropship (Casey's Distributing / FOCO — 2-4 Business Days)"
  },
  {
    id: "ravens-59fifty-purple",
    title: "New Era 59FIFTY Baltimore Ravens Super Bowl XXXV Side-Patch Fitted Hat — Purple (Grey UV)",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era • NFL 59FIFTY Fitted",
    team: "Ravens",
    teamTags: ["Ravens"],
    price: 41.99,
    msrp: 49.99,
    urgency: "Golden 5 Sizes In Stock",
    badge: "SB XXXV Side-Patch • Grey UV",
    sizeType: "hat",
    sizes: ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 3/8",
    image: "/assets/prod-ravens-59fifty.png",
    sku: "NE-5950-BAL-SB35",
    hologram: "Official NFL Hologram + 59FIFTY Gold Foil Visor Sticker • Ships in Rigid Crush-Proof Hat Box",
    fulfillmentMode: "Dropship / Verified Wholesale (2–4 Business Days)"
  },
  {
    id: "eagles-cunningham-1990",
    title: "Mitchell & Ness Philadelphia Eagles Randall Cunningham #12 1990 Kelly Green Legacy Throwback Jersey",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Eagles",
    teamTags: ["Eagles"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • #1 Philly Seller",
    badge: "Official NFL Hologram Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-eagles-cunningham.png",
    sku: "MN-NFL-PHI-1990-12",
    hologram: "Official NFL Shield Metallic Serial Hologram • Sourced via Verified Closeout"
  },
  {
    id: "eagles-reggie-white-1992",
    title: "Mitchell & Ness Philadelphia Eagles Reggie White #92 1992 Kelly Green Minister of Defense Throwback Jersey",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Eagles",
    teamTags: ["Eagles"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • Kelly Green Grail",
    badge: "Stitched Tackle Twill • NFL Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-eagles-reggie-white.png",
    sku: "MN-NFL-PHI-1992-92",
    hologram: "Official NFL Shield Metallic Serial Hologram • Sourced via Verified Closeout"
  },
  {
    id: "sixers-iverson-1996",
    title: "Mitchell & Ness Philadelphia 76ers Allen Iverson #3 1996-97 Hardwood Classics Rookie Black Swingman Jersey",
    category: "nba-jerseys",
    categoryLabel: "NBA Hardwood Classics",
    brand: "Mitchell & Ness • NBA HWC",
    team: "76ers",
    teamTags: ["76ers", "Bulls"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • Matches Bred Jordan 1/4",
    badge: "Hardwood Classics • Stitched",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-sixers-iverson.png",
    sku: "MN-NBA-PHI-1996-03",
    hologram: "NBA Hardwood Classics Serialized Jock Tag"
  },
  // LEAD CATEGORY 3: AUTHENTICATED SNEAKERS (US Men's 9.0–12.0 Core Size Curve)
  {
    id: "aj4-midnight-navy",
    title: "Air Jordan 4 Retro 'Midnight Navy' (DH6927-140) — eBay / Multi-Point Authenticated",
    category: "sneakers",
    categoryLabel: "Authenticated Sneakers",
    brand: "Air Jordan • Retro Authenticated",
    team: "Cowboys",
    teamTags: ["Yankees", "Cowboys", "Giants", "76ers"],
    price: 219.99,
    msrp: 265.00,
    urgency: "Only 2 Left in US 10.5",
    badge: "Verified Authentic • DS Box",
    sizeType: "sneaker",
    sizes: ["9", "9.5", "10", "10.5", "11", "11.5", "12"],
    defaultSize: "10.5",
    image: "/assets/prod-aj4-navy.png",
    sku: "DH6927-140",
    hologram: "eBay Authenticity Guarantee / Multi-Point Tag #PB-AJ4-8821"
  },
  {
    id: "aj1-lost-and-found",
    title: "Air Jordan 1 Retro High OG 'Bred / Chicago Lost & Found' (DZ5485-612) — Verified Deadstock",
    category: "sneakers",
    categoryLabel: "Authenticated Sneakers",
    brand: "Air Jordan • Grail Vault",
    team: "Bulls",
    teamTags: ["Bulls", "76ers", "Chiefs", "Phillies"],
    price: 239.99,
    msrp: 295.00,
    urgency: "Pairs w/ Iverson #3 & Bulls",
    badge: "Multi-Point Authenticated • DS",
    sizeType: "sneaker",
    sizes: ["9", "9.5", "10", "10.5", "11", "11.5", "12"],
    defaultSize: "10.5",
    image: "/assets/prod-aj1-chicago.png",
    sku: "DZ5485-612",
    hologram: "eBay Authenticity Guarantee / Multi-Point Tag #PB-AJ1-9920"
  },
  {
    id: "dunk-low-kelly-green",
    title: "Nike Dunk Low Retro 'Philly Kelly Green & White' (DV0831-101) — Eagles Color-Hook",
    category: "sneakers",
    categoryLabel: "Authenticated Sneakers",
    brand: "Nike • Retro Basketball",
    team: "Eagles",
    teamTags: ["Eagles"],
    price: 109.99,
    msrp: 135.00,
    urgency: "1:1 Match for Eagles Kelly Green",
    badge: "Verified Deadstock • Double-Boxed",
    sizeType: "sneaker",
    sizes: ["9", "9.5", "10", "10.5", "11", "11.5", "12"],
    defaultSize: "10.5",
    image: "/assets/prod-dunk-philly.png",
    sku: "DV0831-101",
    hologram: "Multi-Point Sneaker Auth #PB-DNK-4410"
  },
  {
    id: "dunk-low-knicks",
    title: "Nike Dunk Low Retro 'Knicks Orange & Royal Blue' (DV0833-800) — MSG Hardwood Hook",
    category: "sneakers",
    categoryLabel: "Authenticated Sneakers",
    brand: "Nike • Retro Basketball",
    team: "Knicks",
    teamTags: ["Knicks"],
    price: 109.99,
    msrp: 135.00,
    urgency: "1:1 Match for Ewing #33 Jersey",
    badge: "Verified Deadstock • Double-Boxed",
    sizeType: "sneaker",
    sizes: ["9", "9.5", "10", "10.5", "11", "11.5", "12"],
    defaultSize: "10.5",
    image: "/assets/prod-dunk-knicks.png",
    sku: "DV0833-800",
    hologram: "Multi-Point Sneaker Auth #PB-DNK-5520"
  },
  // LEAD CATEGORY 4: NEW ERA 59FIFTY FITTEDS (Golden 5 Sizes 7 1/8–7 5/8) & CUSTOM PRESS BOX EMBROIDERED CAPS
  {
    id: "eagles-59fifty-kelly",
    title: "New Era 59FIFTY Philadelphia Eagles Kelly Green Throwback Side-Patch Fitted Hat (Grey UV)",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era • NFL 59FIFTY Fitted",
    team: "Eagles",
    teamTags: ["Eagles"],
    price: 41.99,
    msrp: 49.99,
    urgency: "Golden 5 Sizes In Stock",
    badge: "Side-Patch Exclusive • Grey UV",
    sizeType: "hat",
    sizes: ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 3/8",
    image: "/assets/prod-eagles-59fifty.png",
    sku: "NE-5950-PHI-KG",
    hologram: "Official NFL Hologram + 59FIFTY Gold Foil Visor Sticker"
  },
  {
    id: "phillies-59fifty-1980",
    title: "New Era 59FIFTY Philadelphia Phillies 1980 World Series Cooperstown Fitted Hat — Burgundy/Powder",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era • 59FIFTY Cooperstown",
    team: "Phillies",
    teamTags: ["Phillies", "76ers"],
    price: 41.99,
    msrp: 49.99,
    urgency: "Only 3 Left in 7 3/8",
    badge: "Cooperstown Vault • Powder UV",
    sizeType: "hat",
    sizes: ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 3/8",
    image: "/assets/prod-phillies-59fifty.png",
    sku: "NE-5950-PHI-1980",
    hologram: "MLB Official Hologram & 59FIFTY Gold Foil"
  },
  {
    id: "yankees-59fifty-1998",
    title: "New Era 59FIFTY New York Yankees 1998 World Series Side-Patch Fitted Hat — Midnight Navy",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era • 59FIFTY Cooperstown",
    team: "Yankees",
    teamTags: ["Yankees", "Cowboys", "Giants"],
    price: 39.99,
    msrp: 47.99,
    urgency: "Crush-Proof Hat Box",
    badge: "Side-Patch Exclusive • Grey UV",
    sizeType: "hat",
    sizes: ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 3/8",
    image: "/assets/prod-yankees-59fifty.png",
    sku: "NE-5950-NYY-1998",
    hologram: "MLB Cooperstown Collection Gold Prism Sticker"
  },
  {
    id: "chiefs-59fifty-sblviii",
    title: "New Era 59FIFTY Kansas City Chiefs Super Bowl Champions Side-Patch Fitted Hat",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era • NFL On-Field 59FIFTY",
    team: "Chiefs",
    teamTags: ["Chiefs", "Bulls"],
    price: 39.99,
    msrp: 47.99,
    urgency: "Ships in Rigid Hat Box",
    badge: "Championship Side Patch • Golden 5",
    sizeType: "hat",
    sizes: ["7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 1/2",
    image: "/assets/prod-chiefs-59fifty.png",
    sku: "NE-5950-KC-LVIII",
    hologram: "Official NFL Hologram + 59FIFTY Visor Foil"
  },
  {
    id: "pressbox-custom-3dpuff-cap",
    title: "Press Box Custom 3D Puff-Embroidered Cap — Authentic Blank New Era NE400 / Richardson 112",
    category: "fitted-hats",
    categoryLabel: "Fitted & Custom Hats",
    brand: "New Era NE400 (SanMar) • Richardson 112 (S&S)",
    team: "Eagles",
    teamTags: ["Eagles", "76ers", "Knicks", "Yankees", "Phillies"],
    price: 34.99,
    msrp: 44.99,
    urgency: "$0 MOQ Custom Stitch",
    badge: "Authentic New Era / Richardson Blank",
    sizeType: "hat",
    sizes: ["Snapback OSFA", "7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8"],
    defaultSize: "7 3/8",
    image: "/assets/prod-pressbox-custom-cap.png",
    sku: "PB-NE400-R112-3D",
    hologram: "Genuine SanMar New Era NE400 / S&S Activewear Richardson 112"
  },
  // ADDITIONAL MITCHELL & NESS THROWBACKS (Giants, Knicks, Cowboys, Lakers)
  {
    id: "giants-taylor-1986",
    title: "Mitchell & Ness New York Giants Lawrence Taylor #56 1986 Legacy Throwback Jersey",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Giants",
    teamTags: ["Giants"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • 2–4 Day US Dispatch",
    badge: "Stitched Tackle Twill • NFL Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-giants-taylor.png",
    sku: "MN-NFL-NYG-1986-56",
    hologram: "Official NFL Shield Metallic Serial Hologram"
  },
  {
    id: "knicks-ewing-1991",
    title: "Mitchell & Ness New York Knicks Patrick Ewing #33 1991-92 Hardwood Classics Swingman Jersey",
    category: "nba-jerseys",
    categoryLabel: "NBA Hardwood Classics",
    brand: "Mitchell & Ness • NBA HWC",
    team: "Knicks",
    teamTags: ["Knicks"],
    price: 109.99,
    msrp: 135.00,
    urgency: "19% Below MSRP",
    badge: "Official NBA Hologram • Verified Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "L",
    image: "/assets/prod-knicks-ewing.png",
    sku: "MN-NBA-NYK-1991-33",
    hologram: "NBA Hardwood Classics Serialized Jock Tag"
  },
  {
    id: "cowboys-sanders-1995",
    title: "Mitchell & Ness Dallas Cowboys Deion Sanders #21 1995 Double-Star Throwback Jersey — Navy",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "Mitchell & Ness • NFL Legacy",
    team: "Cowboys",
    teamTags: ["Cowboys"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Matches Jordan 4 Navy",
    badge: "Official NFL Legacy • Stitched",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-cowboys-sanders.png",
    sku: "MN-NFL-DAL-1995-21",
    hologram: "Official NFL Shield Metallic Serial Hologram"
  },
  {
    id: "lakers-kobe-1996",
    title: "Mitchell & Ness Los Angeles Lakers Kobe Bryant #8 1996-97 Hardwood Classics Swingman Jersey — Gold",
    category: "nba-jerseys",
    categoryLabel: "NBA Hardwood Classics",
    brand: "Mitchell & Ness • NBA HWC",
    team: "Lakers",
    teamTags: ["Lakers"],
    price: 109.99,
    msrp: 135.00,
    urgency: "Save $25 • Hardwood Grail",
    badge: "Authentic HWC • Verified Tag",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "L",
    image: "/assets/prod-lakers-kobe.png",
    sku: "MN-NBA-LAL-1996-08",
    hologram: "NBA Hardwood Classics Serialized Jock Tag"
  },
  // LEAD CATEGORY 2: FOCO OFFICIAL LICENSED GEAR
  {
    id: "foco-nfl-knit-holiday-sweater",
    title: "FOCO Official NFL Team Logo Jacquard Knit Sweater — All 32 Teams (Ravens, Eagles Kelly Green, Cowboys, Lions, 49ers, Chiefs, Bills)",
    category: "nfl-sweaters",
    categoryLabel: "NFL Team Sweaters (Dropship)",
    brand: "FOCO / Casey's Distributing • Direct Dropship",
    team: "Eagles",
    teamTags: ["Ravens", "Eagles", "Cowboys", "Giants", "Chiefs"],
    price: 59.99,
    msrp: 74.99,
    urgency: "2-4 Day US Dropship • All 32 Teams",
    badge: "Official NFL Knit Sweater • Dropship Ready",
    sizeType: "jersey",
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    defaultSize: "XL",
    image: "/assets/prod-foco-nfl-knit-sweater.png",
    sku: "FOCO-SWT-NFL-KNIT-26",
    hologram: "Official FOCO Forever Collectibles NFL Hologram Hangtag • Dropship via Casey's Distributing (Omaha, NE / Columbus, OH)",
    fulfillmentMode: "Dropship (Casey's Distributing / FOCO — 2-4 Business Days)"
  },
  {
    id: "foco-nfl-retro-crewneck-sweater",
    title: "FOCO Official NFL Vintage Block Wordmark Heavyweight Crewneck Sweater (Ravens, Eagles, Cowboys, Lions, 49ers, Steelers, Giants)",
    category: "nfl-sweaters",
    categoryLabel: "NFL Team Sweaters (Dropship)",
    brand: "FOCO / Casey's Distributing • Direct Dropship",
    team: "Cowboys",
    teamTags: ["Ravens", "Eagles", "Cowboys", "Giants", "Chiefs"],
    price: 54.99,
    msrp: 68.00,
    urgency: "Zero-Inventory Dropship • $0 NJ Tax",
    badge: "Official NFL Heavyweight Crew • Dropship",
    sizeType: "jersey",
    sizes: ["S", "M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-foco-nfl-crewneck.png",
    sku: "FOCO-SWT-NFL-CREW-26",
    hologram: "Official FOCO Forever Collectibles NFL Hologram Hangtag • Dropship via Casey's Distributing",
    fulfillmentMode: "Dropship (Casey's Distributing / FOCO — 2-4 Business Days)"
  },
  {
    id: "foco-official-team-hoodie",
    title: "FOCO Official NFL & NBA Championship Fleece Pullover Hoodie (Ravens, Eagles, Knicks, 76ers, Chiefs, Cowboys)",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "FOCO / Casey's Distributing • Direct Dropship",
    team: "Eagles",
    teamTags: ["Ravens", "Eagles", "Knicks", "76ers", "Chiefs", "Cowboys"],
    price: 64.99,
    msrp: 80.00,
    urgency: "2–4 Day US Dropship • FOCO Tag",
    badge: "Official NFL/NBA Licensed Hoodie",
    sizeType: "jersey",
    sizes: ["M", "L", "XL", "2XL"],
    defaultSize: "XL",
    image: "/assets/prod-foco-eagles-hoodie.png",
    sku: "FOCO-HD-NFL-NBA-26",
    hologram: "Official FOCO Forever Collectibles NFL/NBA Hologram Hangtag"
  },
  {
    id: "foco-official-gel-slides",
    title: "FOCO Official NFL & NBA Team Wordmark Gel Slides & Sherpa Lounge Slippers (Ravens, Eagles, Knicks, Giants, Cowboys)",
    category: "nfl-jerseys",
    categoryLabel: "NFL Jerseys & FOCO Gear",
    brand: "FOCO / Casey's Distributing • Q4 Gift Winner",
    team: "Eagles",
    teamTags: ["Ravens", "Eagles", "Knicks", "Giants", "Cowboys", "Chiefs"],
    price: 36.99,
    msrp: 45.00,
    urgency: "<3% Return Rate • Top Gift Add-On",
    badge: "Official FOCO Licensed • M–XL",
    sizeType: "jersey",
    sizes: ["M (8-9)", "L (10-11)", "XL (12-13)"],
    defaultSize: "L (10-11)",
    image: "/assets/prod-foco-team-slides.png",
    sku: "FOCO-SLD-NFL-NBA-26",
    hologram: "Official FOCO Forever Collectibles NFL/NBA Hologram Hangtag"
  }
];

let state = {
  category: "all",
  team: "all",
  sneakerSize: "all",
  hatSize: "all",
  jerseySize: "all",
  search: "",
  selectedSizes: {},
  cart: [
    {
      productId: "eagles-cunningham-1990",
      size: "XL",
      qty: 1
    },
    {
      productId: "eagles-59fifty-kelly",
      size: "7 3/8",
      qty: 1
    }
  ]
};

PRODUCTS.forEach(p => {
  state.selectedSizes[p.id] = p.defaultSize;
});

function formatMoney(n) {
  return "$" + n.toFixed(2);
}

function getFilteredProducts() {
  return PRODUCTS.filter(p => {
    if (state.category !== "all" && p.category !== state.category && !(state.category === "nfl-jerseys" && p.category === "nfl-sweaters")) return false;
    if (state.team !== "all" && !p.teamTags.includes(state.team) && p.team !== state.team) return false;
    if (state.sneakerSize !== "all" && p.sizeType === "sneaker" && !p.sizes.includes(state.sneakerSize)) return false;
    if (state.hatSize !== "all" && p.sizeType === "hat" && !p.sizes.includes(state.hatSize)) return false;
    if (state.jerseySize !== "all" && p.sizeType === "jersey" && !p.sizes.includes(state.jerseySize)) return false;
    if (state.search.trim() !== "") {
      const q = state.search.toLowerCase();
      const hay = `${p.title} ${p.brand} ${p.team} ${p.teamTags.join(" ")} ${p.categoryLabel} ${p.sku} ${p.sizes.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderCatalog() {
  const grid = document.getElementById("product-grid");
  const statusEl = document.getElementById("filter-status-text");
  const list = getFilteredProducts();

  const activeParts = [];
  if (state.category !== "all") activeParts.push(`Category: ${state.category.toUpperCase()}`);
  if (state.team !== "all") activeParts.push(`Team: ${state.team}`);
  if (state.sneakerSize !== "all") activeParts.push(`Sneaker US ${state.sneakerSize}`);
  if (state.hatSize !== "all") activeParts.push(`59FIFTY ${state.hatSize}`);
  if (state.jerseySize !== "all") activeParts.push(`Jersey ${state.jerseySize}`);
  if (state.search.trim()) activeParts.push(`Search: "${state.search.trim()}"`);

  statusEl.textContent = activeParts.length
    ? `Showing ${list.length} Verified Items (${activeParts.join(" • ")})`
    : `Showing All ${list.length} Dropship-Ready Products (NFL Team Sweaters, Throwbacks, Authenticated Sneakers & 59FIFTY Caps • 2–4 Day US Dispatch)`;

  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; background:#FFFFFF; padding:32px; border-radius:14px; text-align:center; border:1px solid #E2E8F0;">
        <h3 style="font-family:var(--font-display); font-size:1.5rem; color:var(--navy);">NO EXACT MATCHES FOR THAT FILTER COMBO</h3>
        <p style="color:#475569; margin:8px 0 16px;">Reset filters to view all ${PRODUCTS.length} in-stock Authenticated Sneakers, Mitchell & Ness Throwbacks, FOCO Gear, and 59FIFTY Fitteds.</p>
        <button class="btn-gold" onclick="resetAllFilters()">SHOW ALL ${PRODUCTS.length} IN-STOCK ITEMS</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(p => {
    const chosenSize = state.selectedSizes[p.id] || p.defaultSize;
    const saveAmt = Math.round(p.msrp - p.price);
    const sizePillsHtml = p.sizes.map(sz => `
      <button type="button" class="card-size-btn ${chosenSize === sz ? "selected" : ""}"
        onclick="selectCardSize('${p.id}', '${sz}')">${sz}</button>
    `).join("");

    return `
      <article class="product-card" data-id="${p.id}">
        <div class="product-img-wrap" onclick="openQuickView('${p.id}')">
          <div class="card-badges-top">
            <span class="verified-pill">✓ ${p.badge}</span>
            <span class="urgency-pill">${p.urgency}</span>
          </div>
          <img class="product-img" src="${p.image}" alt="${p.title}" loading="lazy" />
        </div>
        <div class="product-body">
          <div class="product-meta-row">
            <span>${p.brand}</span>
            <span class="nj-tax-free-tag">0% NJ TAX</span>
          </div>
          <h3 class="product-title" onclick="openQuickView('${p.id}')">${p.title}</h3>
          <div class="product-price-row">
            <span class="price-now">${formatMoney(p.price)}</span>
            <span class="price-msrp">${formatMoney(p.msrp)} MSRP</span>
            <span class="price-save">SAVE $${saveAmt}</span>
          </div>
          <div class="card-size-selector">
            <div class="card-size-label">
              <span>Select ${p.sizeType === "sneaker" ? "US Men's Sneaker (9–12)" : p.sizeType === "hat" ? "59FIFTY / Cap" : "Apparel"} Size:</span>
              <strong style="color:var(--navy);">${chosenSize}</strong>
            </div>
            <div class="card-size-pills">${sizePillsHtml}</div>
          </div>
          <div class="card-actions">
            <button type="button" class="add-locker-btn" onclick="addToLocker('${p.id}')">
              + ADD TO LOCKER • ${formatMoney(p.price)}
            </button>
            <button type="button" class="quickview-btn" onclick="openQuickView('${p.id}')" title="Inspect 6-Angle Authenticity & Hologram">
              6-ANGLE AUTH
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function selectCardSize(productId, size) {
  state.selectedSizes[productId] = size;
  renderCatalog();
}

function setCategory(cat) {
  state.category = cat;
  document.querySelectorAll(".cat-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.cat === cat);
  });
  renderCatalog();
  document.getElementById("catalog-anchor").scrollIntoView({ behavior: "smooth" });
}

function setTeamFilter(team) {
  state.team = team;
  state.category = "all";
  document.querySelectorAll(".team-pill").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.team === team);
  });
  document.querySelectorAll(".cat-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.cat === "all");
  });
  renderCatalog();
  document.getElementById("catalog-anchor").scrollIntoView({ behavior: "smooth" });
}

function setSneakerSizeFilter(sz) {
  state.sneakerSize = sz;
  if (sz !== "all" && state.category !== "all" && state.category !== "sneakers") {
    state.category = "sneakers";
  }
  document.querySelectorAll("[data-sneaker-size]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sneakerSize === sz);
  });
  renderCatalog();
}

function setHatSizeFilter(sz) {
  state.hatSize = sz;
  if (sz !== "all" && state.category !== "all" && state.category !== "fitted-hats") {
    state.category = "fitted-hats";
  }
  document.querySelectorAll("[data-hat-size]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.hatSize === sz);
  });
  renderCatalog();
}

function applySearchChip(term) {
  const input = document.getElementById("main-search-input");
  input.value = term;
  state.search = term;
  state.category = "all";
  state.team = "all";
  renderCatalog();
  document.getElementById("catalog-anchor").scrollIntoView({ behavior: "smooth" });
}

function resetAllFilters() {
  state.category = "all";
  state.team = "all";
  state.sneakerSize = "all";
  state.hatSize = "all";
  state.jerseySize = "all";
  state.search = "";
  const input = document.getElementById("main-search-input");
  if (input) input.value = "";
  document.querySelectorAll(".cat-tab").forEach(b => b.classList.toggle("active", b.dataset.cat === "all"));
  document.querySelectorAll(".team-pill").forEach(b => b.classList.toggle("active", b.dataset.team === "all"));
  document.querySelectorAll("[data-sneaker-size]").forEach(b => b.classList.toggle("active", b.dataset.sneakerSize === "all"));
  document.querySelectorAll("[data-hat-size]").forEach(b => b.classList.toggle("active", b.dataset.hatSize === "all"));
  renderCatalog();
}

/* Locker Cart Logic */
function addToLocker(productId, overrideSize) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;
  const size = overrideSize || state.selectedSizes[productId] || prod.defaultSize;
  const existing = state.cart.find(item => item.productId === productId && item.size === size);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ productId, size, qty: 1 });
  }
  renderCart();
  openLockerDrawer();
}

function updateCartQty(index, delta) {
  if (!state.cart[index]) return;
  state.cart[index].qty += delta;
  if (state.cart[index].qty <= 0) {
    state.cart.splice(index, 1);
  }
  renderCart();
}

function renderCart() {
  const countEl = document.getElementById("header-locker-count");
  const totalBtnEl = document.getElementById("header-locker-total");
  const drawerItemsEl = document.getElementById("drawer-items-list");
  const subtotalEl = document.getElementById("drawer-subtotal");
  const discountRowEl = document.getElementById("drawer-discount-row");
  const discountValEl = document.getElementById("drawer-discount-val");
  const grandTotalEl = document.getElementById("drawer-grand-total");

  let totalQty = 0;
  let rawSubtotal = 0;

  state.cart.forEach(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    if (p) {
      totalQty += item.qty;
      rawSubtotal += p.price * item.qty;
    }
  });

  // Apply 10% Match Your Kicks Bundle Discount when 3+ items are in the locker
  const qualifiesBundle = totalQty >= 3;
  const discountAmt = qualifiesBundle ? rawSubtotal * 0.10 : 0;
  const finalTotal = rawSubtotal - discountAmt;

  countEl.textContent = totalQty;
  totalBtnEl.textContent = formatMoney(finalTotal);

  if (state.cart.length === 0) {
    drawerItemsEl.innerHTML = `
      <div style="text-align:center; padding:34px 12px; color:#475569;">
        <p style="font-weight:700; color:var(--navy); margin-bottom:6px;">Your Press Box Locker is Empty</p>
        <p style="font-size:0.82rem;">Add any Authenticated Sneaker, Throwback Jersey, FOCO Hoodie/Slides, or 59FIFTY Fitted (3+ items unlock 10% Off automatically).</p>
      </div>
    `;
  } else {
    drawerItemsEl.innerHTML = state.cart.map((item, idx) => {
      const p = PRODUCTS.find(x => x.id === item.productId);
      if (!p) return "";
      return `
        <div class="drawer-item">
          <img src="${p.image}" alt="${p.title}" />
          <div class="drawer-item-info">
            <div class="drawer-item-title">${p.title}</div>
            <div class="drawer-item-meta">Size: <strong>${item.size}</strong> • 0% NJ Tax • Verified Authentic</div>
            <div class="drawer-qty-row">
              <div class="qty-controls">
                <button type="button" class="qty-btn" onclick="updateCartQty(${idx}, -1)">−</button>
                <span style="font-size:0.82rem; font-weight:800;">${item.qty}</span>
                <button type="button" class="qty-btn" onclick="updateCartQty(${idx}, 1)">+</button>
              </div>
              <strong style="color:var(--navy); font-size:0.9rem;">${formatMoney(p.price * item.qty)}</strong>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  subtotalEl.textContent = formatMoney(rawSubtotal);
  if (qualifiesBundle) {
    discountRowEl.style.display = "flex";
    discountValEl.textContent = "−" + formatMoney(discountAmt);
  } else {
    discountRowEl.style.display = "none";
  }
  grandTotalEl.textContent = formatMoney(finalTotal);
}

function openLockerDrawer() {
  document.getElementById("drawer-backdrop").classList.add("open");
  document.getElementById("locker-drawer").classList.add("open");
}

function closeLockerDrawer() {
  document.getElementById("drawer-backdrop").classList.remove("open");
  document.getElementById("locker-drawer").classList.remove("open");
}

/* "Match Your Kicks" 3-Item Bundle Builder ($339.99 Jordan Flagship Bundle / 10% Off Any 3-Piece Combo) */
function initBundleBuilder() {
  const kickSelect = document.getElementById("bundle-kick-select");
  const jerseySelect = document.getElementById("bundle-jersey-select");
  const hatSelect = document.getElementById("bundle-hat-select");

  const kicks = PRODUCTS.filter(p => p.category === "sneakers");
  const jerseys = PRODUCTS.filter(p => p.category === "nfl-jerseys" || p.category === "nfl-sweaters" || p.category === "nba-jerseys");
  const hats = PRODUCTS.filter(p => p.category === "fitted-hats");

  kickSelect.innerHTML = kicks.map(p => `<option value="${p.id}">${p.title} — ${formatMoney(p.price)}</option>`).join("");
  jerseySelect.innerHTML = jerseys.map(p => `<option value="${p.id}">${p.title} — ${formatMoney(p.price)}</option>`).join("");
  hatSelect.innerHTML = hats.map(p => `<option value="${p.id}">${p.title} — ${formatMoney(p.price)}</option>`).join("");

  updateBundleCalculation();
}

function updateBundleCalculation() {
  const kickId = document.getElementById("bundle-kick-select").value;
  const jerseyId = document.getElementById("bundle-jersey-select").value;
  const hatId = document.getElementById("bundle-hat-select").value;

  const kick = PRODUCTS.find(p => p.id === kickId) || PRODUCTS.find(p => p.category === "sneakers");
  const jersey = PRODUCTS.find(p => p.id === jerseyId) || PRODUCTS[0];
  const hat = PRODUCTS.find(p => p.id === hatId) || PRODUCTS.find(p => p.category === "fitted-hats");

  document.getElementById("bundle-kick-preview").innerHTML = `
    <img src="${kick.image}" alt="${kick.title}" />
    <div>
      <div style="font-size:0.78rem; font-weight:800;">${kick.title}</div>
      <div style="font-size:0.74rem; color:#047857; font-weight:700;">${formatMoney(kick.price)} • Double-Boxed</div>
    </div>
  `;
  document.getElementById("bundle-jersey-preview").innerHTML = `
    <img src="${jersey.image}" alt="${jersey.title}" />
    <div>
      <div style="font-size:0.78rem; font-weight:800;">${jersey.title}</div>
      <div style="font-size:0.74rem; color:#047857; font-weight:700;">${formatMoney(jersey.price)} • League Hologram</div>
    </div>
  `;
  document.getElementById("bundle-hat-preview").innerHTML = `
    <img src="${hat.image}" alt="${hat.title}" />
    <div>
      <div style="font-size:0.78rem; font-weight:800;">${hat.title}</div>
      <div style="font-size:0.74rem; color:#047857; font-weight:700;">${formatMoney(hat.price)} • Rigid Hat Box</div>
    </div>
  `;

  const regTotal = kick.price + jersey.price + hat.price;
  const discount = regTotal * 0.10;
  const finalBundle = regTotal - discount;

  document.getElementById("bundle-reg-total").textContent = formatMoney(regTotal);
  document.getElementById("bundle-discount-amt").textContent = "−" + formatMoney(discount) + " (10% OFF)";
  document.getElementById("bundle-final-total").textContent = formatMoney(finalBundle);
}

function applyBundlePreset(presetName) {
  const kickSelect = document.getElementById("bundle-kick-select");
  const jerseySelect = document.getElementById("bundle-jersey-select");
  const hatSelect = document.getElementById("bundle-hat-select");

  if (presetName === "philly") {
    kickSelect.value = "dunk-low-kelly-green";
    jerseySelect.value = "eagles-cunningham-1990";
    hatSelect.value = "eagles-59fifty-kelly";
  } else if (presetName === "navy") {
    kickSelect.value = "aj4-midnight-navy";
    jerseySelect.value = "cowboys-sanders-1995";
    hatSelect.value = "yankees-59fifty-1998";
  } else if (presetName === "chicago") {
    kickSelect.value = "aj1-lost-and-found";
    jerseySelect.value = "sixers-iverson-1996";
    hatSelect.value = "phillies-59fifty-1980";
  } else if (presetName === "knicks") {
    kickSelect.value = "dunk-low-knicks";
    jerseySelect.value = "knicks-ewing-1991";
    hatSelect.value = "yankees-59fifty-1998";
  } else if (presetName === "ravens") {
    kickSelect.value = "aj4-midnight-navy";
    jerseySelect.value = "ravens-ray-lewis-2000";
    hatSelect.value = "ravens-59fifty-purple";
  }
  updateBundleCalculation();
}

function addBundleToLocker() {
  const kickId = document.getElementById("bundle-kick-select").value;
  const kickSize = document.getElementById("bundle-kick-size").value;
  const jerseyId = document.getElementById("bundle-jersey-select").value;
  const jerseySize = document.getElementById("bundle-jersey-size").value;
  const hatId = document.getElementById("bundle-hat-select").value;
  const hatSize = document.getElementById("bundle-hat-size").value;

  addToLocker(kickId, kickSize);
  addToLocker(jerseyId, jerseySize);
  addToLocker(hatId, hatSize);
}

/* 6-Angle Authenticity & Product Quick-View Modal */
function openQuickView(productId) {
  const p = PRODUCTS.find(x => x.id === productId);
  if (!p) return;
  const modal = document.getElementById("quickview-modal");
  const content = document.getElementById("quickview-content");

  content.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1.15fr; gap:20px; align-items:start;">
      <div>
        <img src="${p.image}" alt="${p.title}" style="width:100%; border-radius:12px; border:1px solid #E2E8F0; background:#FFFFFF;" />
        <div class="angle-grid">
          <div class="angle-card"><strong>Angle 1: Studio 3/4</strong>Pure-white Google Shopping compliant hero frame</div>
          <div class="angle-card"><strong>Angle 2: Back / Outsole</strong>Stitched tackle-twill numbers & heel tread check</div>
          <div class="angle-card"><strong>Angle 3: Hologram Macro</strong>${p.hologram}</div>
          <div class="angle-card"><strong>Angle 4: UV / Tongue Tag</strong>Factory SKU ${p.sku} & stitching inspection</div>
          <div class="angle-card"><strong>Angle 5: Fit & Size Spec</strong>True-to-size ${p.sizeType.toUpperCase()} measurements</div>
          <div class="angle-card"><strong>Angle 6: Packaging</strong>Double-boxed / rigid crush-proof box with insured US tracking</div>
        </div>
      </div>
      <div>
        <span class="verified-pill">✓ 100% AUTHENTIC GUARANTEED • SKU: ${p.sku}</span>
        <h2 style="font-family:var(--font-display); font-size:1.65rem; color:var(--navy); margin:8px 0;">${p.title}</h2>
        <div class="product-price-row">
          <span class="price-now">${formatMoney(p.price)}</span>
          <span class="price-msrp">${formatMoney(p.msrp)} MSRP</span>
          <span class="nj-tax-free-tag">0% NJ SALES TAX (ANJ-14)</span>
        </div>
        <p style="font-size:0.86rem; color:#334155; margin-bottom:14px;">
          Sourced directly from authorized US brand distributors and verified closeout channels by
          <strong>Sun Marketing Enterprises LLC (DBA Press Box Kicks & Jerseys • sunmarketingllc@gmail.com)</strong> under the Federal First Sale Doctrine (15 U.S.C. § 1114).
          Ships via insured US carrier with full tracking.
        </p>
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:14px; font-size:0.8rem;">
          <div><strong>✅ Authenticity ID:</strong> ${p.hologram}</div>
          <div><strong>📦 Fulfillment Mode:</strong> ${p.fulfillmentMode || "Direct Supplier Dropship Routing (Casey's Distributing / FOCO / Verified Partner — Ships in 2–4 Business Days)"}</div>
          <div><strong>💸 NJ Tax Status:</strong> $0.00 NJ Footwear & Athletic Apparel Sales Tax (NJ Pub. ANJ-14)</div>
          <div><strong>✉️ Customer Care:</strong> sunmarketingllc@gmail.com</div>
        </div>
        <button type="button" class="btn-gold" style="width:100%;" onclick="closeQuickView(); addToLocker('${p.id}');">
          + ADD TO LOCKER — ${formatMoney(p.price)}
        </button>
      </div>
    </div>
  `;
  modal.classList.add("open");
}

function closeQuickView() {
  document.getElementById("quickview-modal").classList.remove("open");
}

function openCheckoutPreview() {
  closeLockerDrawer();
  const modal = document.getElementById("quickview-modal");
  const content = document.getElementById("quickview-content");
  content.innerHTML = `
    <div style="text-align:center; padding:16px 8px;">
      <span class="verified-pill">🔒 LIVE STOREFRONT PREVIEW • $0.00 DEMO MODE</span>
      <h2 style="font-family:var(--font-display); font-size:1.9rem; color:var(--navy); margin:10px 0;">
        PRESS BOX KICKS & JERSEYS — EXPRESS CHECKOUT PREVIEW
      </h2>
      <p style="color:#475569; max-width:580px; margin:0 auto 16px; font-size:0.9rem;">
        Operated by <strong>Sun Marketing Enterprises LLC DBA Press Box Kicks & Jerseys</strong> (<span class="address-placeholder-box" style="display:inline-block; min-width:120px; min-height:18px; border:1px dashed #94A3B8; border-radius:4px; vertical-align:middle;"></span> • <code>sunmarketingllc@gmail.com</code> • <code>pressboxkicksjerseys.com</code> • <code>@pressboxkicks</code> / <code>@pressboxjerseys</code>).
        Stripe, Apple Pay, Google Pay, and automatic <strong>0% NJ Sales Tax on Clothes & Shoes</strong> are staged and ready for activation upon Fred's approval.
      </p>
      <button type="button" class="btn-gold" onclick="closeQuickView()">CONTINUE SHOPPING PREVIEW</button>
    </div>
  `;
  modal.classList.add("open");
}

document.addEventListener("DOMContentLoaded", () => {
  renderCatalog();
  renderCart();
  initBundleBuilder();

  const searchInput = document.getElementById("main-search-input");
  searchInput.addEventListener("input", e => {
    state.search = e.target.value;
    renderCatalog();
  });
});

/* ==========================================================================
   THE PRESS BOX WIRE (/news) — 5-ZONE EDITORIAL & NATURAL PRODUCT THREADING
   ========================================================================== */
const WIRE_ARTICLES = [
  {
    id: "nfl-throwback-schedule-kelly-green-guide",
    slug: "/news/nfl-throwback-uniform-schedule-kelly-green-style-guide",
    category: "NFL • Uniform Wire",
    categoryKey: "nfl",
    sportTags: ["nfl"],
    date: "Oct 25, 2026 • 6 Min Read",
    headline: "NFL Throwback Uniform Schedule & Style Report: Eagles Kelly Green Dates, NY Giants Classic Blue & Cowboys Double-Star Games",
    subheadline: "Inside the NFC East's 2026 throwback uniform calendar—and why 1990s Randall Cunningham #12, Reggie White #92, and Lawrence Taylor #56 heavy-mesh stitched throwbacks define stadium style.",
    heroImage: "/assets/prod-eagles-cunningham.png",
    midStoryNoteLabel: "Uniform Note",
    midStoryNoteText: "The 1990 Randall Cunningham #12 and 1992 Reggie White #92 Mitchell & Ness Legacy Throwbacks ($109.99, 0% NJ tax) are stocked in the Press Box Locker.",
    midStoryProductId: "eagles-cunningham-1990",
    midStoryCta: "View Jersey →",
    bundlePreset: "philly",
    bundlePresetLabel: "Build the Philly Kelly Green 3-Piece Look ($235.77)",
    takeaways: [
      "Philadelphia Eagles Kelly Green throwback weeks drive a 340% surge in collector demand for stitched 1990 #12 Cunningham and 1992 #92 Reggie White Legacy jerseys.",
      "NFC East divisional throwback dates also spotlight the 1986 NY Giants Lawrence Taylor #56 Classic Blue and 1995 Dallas Cowboys Deion Sanders #21 Double-Star jerseys.",
      "Every authentic Mitchell & Ness throwback at Press Box ($109.99 vs. $135 MSRP) carries official NFL metallic serial holograms and ships with $0.00 NJ clothes tax."
    ],
    bodyHtml: `
      <p style="margin-bottom:12px;">When the Philadelphia Eagles take the field in their iconic 1990s <strong>Kelly Green and Silver</strong> throwback uniforms, standard modern screen-printed jerseys don't cut it. Across the Delaware Valley and Tri-State corridor, collectors and game-day tailgaters look for heavy mesh, stitched tackle-twill numbering, and authentic throwback patches.</p>
      <div class="wire-midstory-note" style="background:#ECFDF5; border-color:#10B981; color:#0F172A;">
        <div><strong style="color:#047857;">Uniform Note:</strong> The 1990 Randall Cunningham #12 and 1992 Reggie White #92 Mitchell &amp; Ness Legacy Throwbacks ($109.99, 0% NJ tax) are stocked in the Press Box Locker.</div>
        <button type="button" class="btn-gold" style="padding:5px 12px; font-size:0.74rem;" onclick="openQuickView('eagles-cunningham-1990')">View Jersey →</button>
      </div>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">1. The Two Undisputed Kelly Green Grails: #12 Cunningham &amp; #92 Reggie White</h4>
      <p style="margin-bottom:12px;">Our #1 and #2 fastest-moving NFL silhouettes are the <strong>Mitchell &amp; Ness 1990 Randall Cunningham #12</strong> and <strong>1992 Reggie White #92 "Minister of Defense"</strong> Legacy jerseys (both <strong>$109.99</strong> at Press Box vs. $135.00 retail MSRP). Both carry the vintage flying eagle sleeve embroidery, authentic jock tags, and official NFL Shield hologram verification.</p>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">2. NFC East Rival Throwbacks: NY Giants #56 LT &amp; Dallas Cowboys #21 Deion Sanders</h4>
      <p style="margin-bottom:12px;">For Meadowlands Classic Blue throwback dates and NFC East divisional showdowns, we stock the <strong>1986 Lawrence Taylor #56 Giants Legacy Throwback ($109.99)</strong> and the <strong>1995 Deion Sanders #21 Cowboys Double-Star Throwback ($109.99)</strong> in core men's sizes M through 2XL—shipped with insured US tracking and <strong>$0.00 NJ sales tax</strong> under NJ Publication ANJ-14.</p>
    `,
    featuredProducts: ["eagles-cunningham-1990", "eagles-59fifty-kelly", "dunk-low-kelly-green"],
    affiliateNote: "Rare Vintage Sizes & Game Tickets: Check verified rare sizes via eBay Partner Network (4% EPN) or NFC East game-day seats via SeatGeek (Affiliate Disclosure)."
  },
  {
    id: "nba-tunnel-walk-kicks-on-court-report",
    slug: "/news/nba-tunnel-walk-kicks-on-court-retro-jordans-hardwood-classics",
    category: "NBA • Tunnel & Kicks",
    categoryKey: "nba",
    sportTags: ["nba", "kicks"],
    date: "Oct 25, 2026 • 5 Min Read",
    headline: "NBA Tunnel Walk & 'Kicks on Court' Report: How 76ers, Knicks & Lakers Stars Pair 90s Hardwood Classics with OG Jordan 1s",
    subheadline: "Inside the 2026–27 arena arrival formula across South Philly, Madison Square Garden, and LA: Allen Iverson #3, Patrick Ewing #33, and Kobe Bryant #8 Swingman jerseys paired with deadstock retro heat.",
    heroImage: "/assets/prod-sixers-iverson.png",
    midStoryNoteLabel: "Tunnel Style Note",
    midStoryNoteText: "The 1996–97 Allen Iverson #3 Sixers Rookie Black Hardwood Classics Swingman ($109.99) and Air Jordan 1 High OG 'Bred / Lost & Found' ($239.99) are both in stock for insured US dispatch.",
    midStoryProductId: "sixers-iverson-1996",
    midStoryCta: "View Iverson #3 →",
    bundlePreset: "chicago",
    bundlePresetLabel: "Build the Iverson #3 + Jordan 1 Bred 3-Piece Look ($339.99)",
    takeaways: [
      "The 1996–97 Allen Iverson #3 Rookie Black Hardwood Classics Swingman ($109.99) is the #1 tunnel-walk pairing for 'Bred / Chicago Lost & Found' Air Jordan 1 High OGs ($239.99).",
      "Madison Square Garden tunnel fits continue to anchor around the 1991–92 Patrick Ewing #33 Royal Blue Swingman ($109.99) and Nike Dunk Low 'Knicks Orange & Royal' ($109.99).",
      "Every NBA Hardwood Classics jersey ships with serialized NBA jock tags and 0% NJ clothing sales tax."
    ],
    bodyHtml: `
      <p style="margin-bottom:12px;">From Wells Fargo Center in South Philly to Madison Square Garden and Crypto.com Arena, the pre-game NBA player tunnel has cemented one timeless rule: <strong>90s Hardwood Classics Swingman jerseys paired with OG Air Jordan 1s, Air Jordan 4s, or two-tone Nike Dunks</strong> outperform modern fast-fashion every night of the week.</p>
      <div class="wire-midstory-note" style="background:#ECFDF5; border-color:#10B981; color:#0F172A;">
        <div><strong style="color:#047857;">Tunnel Style Note:</strong> The 1996–97 Allen Iverson #3 Sixers Hardwood Classics Swingman ($109.99) and Air Jordan 1 High OG 'Bred / Lost &amp; Found' ($239.99) are stocked in the Press Box Locker.</div>
        <button type="button" class="btn-gold" style="padding:5px 12px; font-size:0.74rem;" onclick="openQuickView('sixers-iverson-1996')">View Iverson #3 →</button>
      </div>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">1. The Sixers Black-and-Crimson Tunnel Hook: Iverson #3 + Air Jordan 1 High OG</h4>
      <p style="margin-bottom:12px;">The <strong>Mitchell &amp; Ness 1996–97 Allen Iverson #3 Rookie Black Swingman ($109.99)</strong> features crimson, gold, and royal starburst detailing across the chest that locks directly into the varsity red and black leather of the <strong>Air Jordan 1 Retro High OG 'Bred / Lost &amp; Found' ($239.99)</strong>. Add a Phillies 1980 World Series 59FIFTY ($41.99) in our Bundle Builder to lock in the entire 3-piece fit for <strong>$339.99 total</strong>.</p>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">2. MSG &amp; West Coast Royalty: Patrick Ewing #33 &amp; Kobe Bryant #8</h4>
      <p style="margin-bottom:12px;">For New York and Los Angeles collectors, our verified lineup pairs the <strong>Patrick Ewing #33 Knicks 1991–92 Hardwood Classics Jersey ($109.99)</strong> and <strong>Kobe Bryant #8 1996–97 Gold Rookie Swingman ($109.99)</strong> with multi-point authenticated sneakers in Men's US 9.0–12.0.</p>
    `,
    featuredProducts: ["sixers-iverson-1996", "phillies-59fifty-1980", "aj1-lost-and-found"],
    affiliateNote: "Out-of-Stock Player Sizes: Compare verified secondary market pairs on eBay Authenticity Guarantee / StockX (Affiliate Disclosure)."
  },
  {
    id: "air-jordan-1-and-4-release-restock-calendar-q4-2026",
    slug: "/news/air-jordan-1-jordan-4-release-restock-buyers-guide-q4-2026",
    category: "Kicks & Drops • Sneaker Vault",
    categoryKey: "kicks",
    sportTags: ["kicks", "nfl", "nba"],
    date: "Oct 25, 2026 • 7 Min Read",
    headline: "Air Jordan 1 & Air Jordan 4 Release & Restock Radar (Q4 2026): Why 'Midnight Navy' AJ4 & 'Lost & Found' AJ1 Lead Game-Day Rotation",
    subheadline: "Why Men's Sizes 9.0 to 12.0 command the tightest deadstock supply—and how multi-point authentication plus 0% NJ shoe tax save buyers $35 to $55 per pair.",
    heroImage: "/assets/prod-aj4-navy.png",
    midStoryNoteLabel: "Sneaker Vault Note",
    midStoryNoteText: "Verified deadstock Air Jordan 4 Retro 'Midnight Navy' ($219.99, SKU DH6927-140) and Air Jordan 1 High OG 'Lost & Found' ($239.99, SKU DZ5485-612) are in stock in US Men's 9.0–12.0.",
    midStoryProductId: "aj4-midnight-navy",
    midStoryCta: "View Jordan 4 →",
    bundlePreset: "navy",
    bundlePresetLabel: "Build the Jordan 4 Navy + Throwback 3-Piece Look ($332.97)",
    takeaways: [
      "Air Jordan 4 Retro 'Midnight Navy' (DH6927-140, $219.99) pairs white tumbled leather and navy cement splatters—making it the universal sneaker for Cowboys, Yankees, Giants, and 76ers fans.",
      "Air Jordan 1 High OG 'Bred / Chicago Lost & Found' (DZ5485-612, $239.99) remains the #1 holiday grail sneaker for Bulls, Sixers, Chiefs, and Phillies fits.",
      "Every pair is inspected across 6 angles (stitching, tongue SKU tag, midsole, box label, UV stamp, and authentication tag) and shipped double-boxed with insured US tracking."
    ],
    bodyHtml: `
      <p style="margin-bottom:12px;">Buying retro Air Jordans online shouldn't feel like a gamble on slow overseas shipping, hidden platform buyer fees, or crushed shoeboxes. At <strong>Press Box Kicks &amp; Jerseys</strong>, we concentrate exclusively on the core <strong>US Men's 9.0 to 12.0 size curve</strong> (<code>9, 9.5, 10, 10.5, 11, 11.5, 12</code>) where every pair is multi-point authenticated and shipped double-boxed with insured US tracking.</p>
      <div class="wire-midstory-note" style="background:#ECFDF5; border-color:#10B981; color:#0F172A;">
        <div><strong style="color:#047857;">Sneaker Vault Note:</strong> Multi-point authenticated Air Jordan 4 'Midnight Navy' ($219.99) and Air Jordan 1 'Lost &amp; Found' ($239.99) pairs are ready for double-boxed dispatch.</div>
        <button type="button" class="btn-gold" style="padding:5px 12px; font-size:0.74rem;" onclick="openQuickView('aj4-midnight-navy')">View Jordan 4 →</button>
      </div>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">1. Air Jordan 4 Retro 'Midnight Navy' (SKU: DH6927-140 — $219.99)</h4>
      <p style="margin-bottom:12px;">Built with crisp white tumbled leather, Midnight Navy wing eyelets, and signature grey cement splatter on the midsole and heel tab, the <strong>Jordan 4 'Midnight Navy'</strong> is the ultimate crossover sneaker for <strong>Dallas Cowboys (#21 Deion Sanders)</strong>, <strong>NY Yankees (1998 WS 59FIFTY)</strong>, and <strong>NY Giants (#56 LT)</strong> game days.</p>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">2. Zero NJ Footwear Tax = Instant $15–$20 Tax Savings Over NY/PA Marketplaces</h4>
      <p style="margin-bottom:12px;">Under New Jersey Publication ANJ-14, everyday athletic footwear and apparel are exempt from NJ state sales tax—and when you bundle your Jordan 1s or Jordan 4s with any Mitchell &amp; Ness Jersey + 59FIFTY Fitted, you save an extra <strong>10% Off automatically</strong>.</p>
    `,
    featuredProducts: ["aj4-midnight-navy", "cowboys-sanders-1995", "yankees-59fifty-1998"],
    affiliateNote: "Extended Sizes (US 8, 13, 14+): Check verified deadstock listings via eBay Authenticity Guarantee & StockX (Affiliate Disclosure)."
  },
  {
    id: "philly-kelly-green-vs-knicks-dunk-low-buyers-guide",
    slug: "/news/philly-kelly-green-vs-knicks-orange-royal-nike-dunk-low-guide",
    category: "Kicks & Drops • I-95 Rivalry",
    categoryKey: "kicks",
    sportTags: ["kicks", "nfl", "nba"],
    date: "Oct 25, 2026 • 5 Min Read",
    headline: "I-95 Sneaker Showdown: Philly Kelly Green vs. Knicks Orange & Royal Nike Dunk Lows Under $110",
    subheadline: "Comparing SKU DV0831-101 ('Philly Kelly Green') and SKU DV0833-800 ('Knicks Orange & Royal') at $109.99—and why two-tone retro leather Dunks dominate stadium tailgates.",
    heroImage: "/assets/prod-dunk-philly.png",
    midStoryNoteLabel: "Colorway Match Note",
    midStoryNoteText: "Both the Nike Dunk Low 'Philly Kelly Green' ($109.99) and 'Knicks Orange & Royal Blue' ($109.99) are in stock in US Men's 9.0–12.0 with $0.00 NJ shoe tax.",
    midStoryProductId: "dunk-low-kelly-green",
    midStoryCta: "View Philly Dunk →",
    bundlePreset: "knicks",
    bundlePresetLabel: "Build the Knicks Dunk + Ewing #33 3-Piece Look ($233.97)",
    takeaways: [
      "At $109.99 (vs. $135.00 MSRP), two-tone leather Nike Dunk Lows deliver the highest color-match impact per dollar for NFL tailgates and NBA watch parties.",
      "Nike Dunk Low 'Philly Kelly Green' (DV0831-101) matches the exact 1990–1992 Eagles Kelly Green shade on our Cunningham #12 and Reggie White #92 jerseys.",
      "Nike Dunk Low 'Knicks Orange & Royal' (DV0833-800) locks directly into the 1991–92 Patrick Ewing #33 Hardwood Classics Swingman and FOCO Team Fleece Hoodie."
    ],
    bodyHtml: `
      <p style="margin-bottom:12px;">Not every game day calls for risking a $240 pair of grail Jordan 1s in a stadium parking lot. That is why the <strong>Nike Dunk Low Retro ($109.99 at Press Box)</strong> has become the #1 everyday tailgate and arena sneaker across Philadelphia, South Jersey, and New York.</p>
      <div class="wire-midstory-note" style="background:#ECFDF5; border-color:#10B981; color:#0F172A;">
        <div><strong style="color:#047857;">Colorway Match Note:</strong> Nike Dunk Low 'Philly Kelly Green' ($109.99) and 'Knicks Orange &amp; Royal' ($109.99) ship double-boxed with insured US tracking.</div>
        <button type="button" class="btn-gold" style="padding:5px 12px; font-size:0.74rem;" onclick="openQuickView('dunk-low-kelly-green')">View Philly Dunk →</button>
      </div>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">1. The I-95 Rivalry Breakdown: Kelly Green (DV0831-101) vs. MSG Orange &amp; Royal (DV0833-800)</h4>
      <p style="margin-bottom:12px;">Both colorways feature clean white leather toe boxes with bold team-color overlays that wipe clean in seconds after a tailgate. Even better, pairing either $109.99 Dunk Low with a $109.99 Mitchell &amp; Ness Throwback Jersey and a $39.99–$41.99 New Era 59FIFTY Fitted drops your <strong>entire 3-piece outfit to $233.97–$235.77 after our automatic 10% Bundle Discount</strong>—with $0.00 NJ sales tax and free insured US shipping on $150+ orders.</p>
    `,
    featuredProducts: ["dunk-low-kelly-green", "dunk-low-knicks", "knicks-ewing-1991"],
    affiliateNote: "More Team-Colorway Dunks: Browse verified closeout colorways via eBay Partner Network / StockX (Affiliate Disclosure)."
  },
  {
    id: "fitted-collectors-guide-new-era-59fifty-side-patches",
    slug: "/news/new-era-59fifty-side-patch-sizing-guide-golden-5-custom-3d-puff",
    category: "MLB & NFL • Cooperstown & 59FIFTY Desk",
    categoryKey: "mlb",
    sportTags: ["mlb", "nfl"],
    date: "Oct 25, 2026 • 6 Min Read",
    headline: "MLB Cooperstown & Super Bowl Side-Patch Report: Phillies 1980 WS, Yankees 1998 WS & 'Golden 5' 59FIFTY Sizing Guide",
    subheadline: "Why vintage World Series and Super Bowl commemorative patches lead fitted collector demand—plus how to find your exact 'Golden 5' crown size (7 1/8 to 7 5/8).",
    heroImage: "/assets/prod-phillies-59fifty.png",
    midStoryNoteLabel: "Collector Crown Note",
    midStoryNoteText: "Phillies 1980 World Series Cooperstown ($41.99), Yankees 1998 WS ($39.99), Eagles Kelly Green ($41.99), and Custom 3D-Puff NE400 Caps ($34.99) ship in crush-proof rigid hat boxes.",
    midStoryProductId: "phillies-59fifty-1980",
    midStoryCta: "View 59FIFTY Cap →",
    bundlePreset: "philly",
    bundlePresetLabel: "Build Your 59FIFTY + Jersey + Kicks 3-Piece Look (10% Off)",
    takeaways: [
      "Over 82% of men's fitted hat collectors wear one of the 'Golden 5' sizes: 7 1/8 (56.8cm), 7 1/4 (57.7cm), 7 3/8 (58.7cm), 7 1/2 (59.6cm), or 7 5/8 (60.6cm).",
      "Every 59FIFTY at Press Box ships in a rigid crush-proof 8x8x6 box—never a poly mailer—so structured high crowns and commemorative World Series / Super Bowl side patches arrive crisp.",
      "Our Custom 3D-Puff Press Box Cap ($34.99) is stitched on genuine blank New Era NE400 (SanMar) and Richardson 112 (S&S Activewear) crowns with zero league trademarks."
    ],
    bodyHtml: `
      <p style="margin-bottom:12px;">Nothing ruins a collectible <strong>New Era 59FIFTY World Series or Super Bowl Side-Patch Fitted</strong> faster than a seller stuffing a structured wool-blend crown into a plastic poly bag. At Press Box Kicks &amp; Jerseys, every fitted and snapback ships inside a <strong>rigid crush-proof corrugated hat box</strong> with full tracking.</p>
      <div class="wire-midstory-note" style="background:#ECFDF5; border-color:#10B981; color:#0F172A;">
        <div><strong style="color:#047857;">Collector Crown Note:</strong> Phillies 1980 World Series ($41.99), Yankees 1998 WS ($39.99), and Eagles Kelly Green ($41.99) 59FIFTY fitteds are stocked in Golden 5 sizes (7 1/8–7 5/8).</div>
        <button type="button" class="btn-gold" style="padding:5px 12px; font-size:0.74rem;" onclick="openQuickView('phillies-59fifty-1980')">View 59FIFTY Cap →</button>
      </div>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">1. Mastering the 'Golden 5' Fitted Size Curve (7 1/8 through 7 5/8)</h4>
      <p style="margin-bottom:12px;">We stock the five core sizes that account for over 80% of collector demand: <strong>7 1/8 (22 3/8"), 7 1/4 (22 3/4"), 7 3/8 (23 1/8" — #1 most popular size), 7 1/2 (23 1/2"), and 7 5/8 (23 7/8")</strong> across our <strong>Phillies 1980 World Series Cooperstown ($41.99)</strong>, <strong>Yankees 1998 World Series ($39.99)</strong>, <strong>Eagles Kelly Green Side-Patch ($41.99)</strong>, and <strong>Chiefs Super Bowl LVIII ($39.99)</strong> fitteds.</p>
      <h4 style="color:var(--navy); font-family:var(--font-display); font-size:1.15rem; margin:14px 0 6px;">2. Custom 3D-Puff Embroidery on Genuine New Era NE400 &amp; Richardson 112 Blanks ($34.99)</h4>
      <p style="margin-bottom:12px;">Looking for a clean stadium-colorway cap without league logos—or custom 3D puff embroidery for your local crew, podcast, or rec league? We stitch raised 3D metallic gold and team-color puff embroidery directly onto authentic blank <strong>New Era NE400/NE401 caps (sourced via SanMar)</strong> and <strong>Richardson 112 trucker caps (sourced via our active S&amp;S Activewear account)</strong> at $34.99 with $0 minimum order quantity.</p>
    `,
    featuredProducts: ["phillies-59fifty-1980", "yankees-59fifty-1998", "pressbox-custom-3dpuff-cap"],
    affiliateNote: "Rare Fitted Sizes (7, 7 3/4, 8): Check verified collector inventory via eBay Partner Network / secondary collector listings (Affiliate Disclosure)."
  }
];

let currentWireFilter = "all";

function renderZone4FitSpotlightCard() {
  return `
    <!-- ZONE 4: Between-Articles Feed Placement #3 — Native "Game-Day Fit Spotlight" Card -->
    <div class="wire-fit-spotlight-card" id="wire-zone4-fit-spotlight">
      <div>
        <span class="wire-spotlight-kicker">✨ GAME-DAY FIT SPOTLIGHT • EDITORIAL STYLE BREAKDOWN</span>
        <h3 style="font-family:var(--font-display); font-size:1.45rem; color:#FFFFFF; margin-bottom:8px;">
          How Tunnel-Walk Stars Pair 'Midnight Navy' Jordan 4s with Classic Throwbacks &amp; Cooperstown Fitteds
        </h3>
        <p style="font-size:0.84rem; color:#CBD5E1; line-height:1.55; margin-bottom:12px;">
          Why does the <strong>Air Jordan 4 Retro 'Midnight Navy' ($219.99)</strong> anchor so many NFL and MLB tunnel arrivals? Its crisp white tumbled leather upper and navy cement splatter bridge the exact navy palette of the <strong>1995 Dallas Cowboys Deion Sanders #21 Double-Star Throwback ($109.99)</strong> and the <strong>New Era 59FIFTY 1998 World Series Yankees Side-Patch Fitted ($39.99)</strong>—creating a cohesive 3-piece look without clashing tones.
        </p>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn-gold" style="padding:9px 16px; font-size:0.82rem;" onclick="loadWireBundlePreset('navy')">
            ⚡ Pre-Load This 3-Piece Navy Look in Bundle Builder ($332.97 • Save 10%)
          </button>
          <span style="font-size:0.75rem; color:#6EE7B7; font-weight:700;">✓ 0% NJ Tax • Free Insured US Shipping ($150+)</span>
        </div>
      </div>
      <div class="wire-spotlight-items">
        <div class="wire-spotlight-mini" onclick="openQuickView('aj4-midnight-navy')">
          <img src="/assets/prod-aj4-navy.png" alt="Air Jordan 4 Midnight Navy" loading="lazy" />
          <div style="font-size:0.72rem; font-weight:800; color:#FFFFFF;">Jordan 4 'Navy'</div>
          <div style="font-size:0.7rem; color:var(--gold); font-weight:700;">$219.99</div>
        </div>
        <div class="wire-spotlight-mini" onclick="openQuickView('cowboys-sanders-1995')">
          <img src="/assets/prod-cowboys-sanders.png" alt="Deion Sanders #21 Throwback" loading="lazy" />
          <div style="font-size:0.72rem; font-weight:800; color:#FFFFFF;">Deion #21 '95</div>
          <div style="font-size:0.7rem; color:var(--gold); font-weight:700;">$109.99</div>
        </div>
        <div class="wire-spotlight-mini" onclick="openQuickView('yankees-59fifty-1998')">
          <img src="/assets/prod-yankees-59fifty.png" alt="Yankees 1998 WS 59FIFTY" loading="lazy" />
          <div style="font-size:0.72rem; font-weight:800; color:#FFFFFF;">Yankees '98 WS</div>
          <div style="font-size:0.7rem; color:var(--gold); font-weight:700;">$39.99</div>
        </div>
      </div>
    </div>
  `;
}

function renderWireArticles(filterKey) {
  currentWireFilter = filterKey || "all";
  const grid = document.getElementById("wire-articles-grid");
  if (!grid) return;

  document.querySelectorAll(".wire-pill").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.wireCat === currentWireFilter);
  });

  const filtered = currentWireFilter === "all"
    ? WIRE_ARTICLES
    : WIRE_ARTICLES.filter(a => a.categoryKey === currentWireFilter || (a.sportTags && a.sportTags.includes(currentWireFilter)));

  const htmlBlocks = [];

  filtered.forEach((article, index) => {
    const linkedProds = article.featuredProducts
      .map(pid => PRODUCTS.find(p => p.id === pid))
      .filter(Boolean);

    const miniCardsHtml = linkedProds.slice(0, 3).map(p => `
      <div class="wire-mini-prod">
        <div class="wire-mini-prod-left" onclick="openQuickView('${p.id}')">
          <img src="${p.image}" alt="${p.title}" loading="lazy" />
          <div style="min-width:0;">
            <div class="wire-mini-prod-name">${p.title}</div>
            <div class="wire-mini-prod-price">${formatMoney(p.price)} <span style="color:#94A3B8; text-decoration:line-through; font-weight:500;">${formatMoney(p.msrp)}</span> • Size ${p.defaultSize}</div>
          </div>
        </div>
        <button type="button" class="wire-mini-add-btn" onclick="addToLocker('${p.id}')">+ LOCKER</button>
      </div>
    `).join("");

    htmlBlocks.push(`
      <article class="wire-article-row" id="wire-card-${article.id}">
        <!-- Left Editorial Column (News First + Zone 2 Contextual Note + Zone 5 Natural Next Step Handoff) -->
        <div class="wire-article-main">
          <div>
            <div class="wire-card-top">
              <img src="${article.heroImage}" alt="${article.headline}" class="wire-thumb" loading="lazy" />
              <div>
                <div class="wire-meta">
                  <span class="wire-tag">${article.category}</span>
                  <span class="wire-date">${article.date}</span>
                </div>
                <h3 class="wire-headline" onclick="openWireArticle('${article.id}')">${article.headline}</h3>
              </div>
            </div>

            <div class="wire-body">
              <p>${article.subheadline}</p>

              <!-- ZONE 2: Mid-Story Placement #1 — Contextual "Mentioned in This Report" Editorial Note -->
              <div class="wire-midstory-note">
                <div>
                  <strong>${article.midStoryNoteLabel}:</strong> ${article.midStoryNoteText}
                </div>
                <button type="button" class="wire-midstory-link" onclick="openQuickView('${article.midStoryProductId}')">
                  ${article.midStoryCta}
                </button>
              </div>

              <ul class="wire-takeaways">
                ${article.takeaways.map(t => `<li>${t}</li>`).join("")}
              </ul>
            </div>
          </div>

          <!-- ZONE 5: End-of-Article Placement #4 — "Your Natural Next Step: Build the 3-Piece Look" -->
          <div class="wire-nextstep-handoff">
            <div class="wire-nextstep-label">
              <strong>Your Natural Next Step:</strong> Pre-load this report's exact Jersey + 59FIFTY Cap + Authenticated Kicks with automatic 10% bundle savings.
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="wire-read-btn" onclick="openWireArticle('${article.id}')">📖 Read Full Report</button>
              <button type="button" class="wire-bundle-btn" onclick="loadWireBundlePreset('${article.bundlePreset}')">⚡ ${article.bundlePresetLabel}</button>
            </div>
          </div>
        </div>

        <!-- ZONE 3: Sidebar / Companion Placement #2 — "The Story Locker" Right-Rail Card -->
        <aside class="wire-story-locker-rail" aria-label="The Story Locker Companion Items">
          <div>
            <div class="wire-shop-title">
              <span>🔒 THE STORY LOCKER (COMPANION GEAR)</span>
              <span style="color:#FFD700;">0% NJ TAX</span>
            </div>
            <p style="font-size:0.73rem; color:#94A3B8; margin-bottom:10px;">
              The exact ${linkedProds.length} verified items referenced in this report — in stock for insured US dispatch:
            </p>
            <div class="wire-mini-products">
              ${miniCardsHtml}
            </div>
          </div>
          <div class="wire-affiliate-note">
            <div>🛡️ 100% Original Press Box Studio Assets • First Amendment Nominative Fair Use</div>
            <div style="margin-top:3px;">🔗 ${article.affiliateNote}</div>
          </div>
        </aside>
      </article>
    `);

    // ZONE 4: Between-Articles Feed Placement #3 — Native "Game-Day Fit Spotlight" Card between Article #2 and Article #3
    if (index === 1) {
      htmlBlocks.push(renderZone4FitSpotlightCard());
    }
  });

  grid.innerHTML = htmlBlocks.join("");
}

function openWireArticle(articleId) {
  const article = WIRE_ARTICLES.find(a => a.id === articleId);
  if (!article) return;
  const modal = document.getElementById("quickview-modal");
  const content = document.getElementById("quickview-content");

  const linkedProds = article.featuredProducts
    .map(pid => PRODUCTS.find(p => p.id === pid))
    .filter(Boolean);

  const shopCardsHtml = linkedProds.map(p => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:10px; padding:10px 12px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${p.image}" alt="${p.title}" style="width:54px; height:54px; object-fit:contain; border-radius:8px; border:1px solid #E2E8F0;" />
        <div>
          <div style="font-size:0.84rem; font-weight:800; color:var(--navy);">${p.title}</div>
          <div style="font-size:0.76rem; color:#047857; font-weight:700;">${formatMoney(p.price)} <span style="color:#64748B; text-decoration:line-through;">${formatMoney(p.msrp)} MSRP</span> • Default Size: ${p.defaultSize} • 0% NJ Tax</div>
        </div>
      </div>
      <button type="button" class="btn-gold" style="padding:8px 14px; font-size:0.78rem; white-space:nowrap;" onclick="closeQuickView(); addToLocker('${p.id}');">
        + ADD TO LOCKER (${formatMoney(p.price)})
      </button>
    </div>
  `).join("");

  content.innerHTML = `
    <div>
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <span class="verified-pill">📰 THE PRESS BOX WIRE (${article.slug}) • ${article.category.toUpperCase()}</span>
        <span style="font-size:0.76rem; color:#475569; font-weight:700;">${article.date} • By Press Box Editorial Desk</span>
      </div>
      <h2 style="font-family:var(--font-display); font-size:1.75rem; color:var(--navy); line-height:1.15; margin-bottom:8px;">${article.headline}</h2>
      <p style="font-size:0.92rem; color:#334155; font-weight:600; margin-bottom:14px;">${article.subheadline}</p>

      <div style="background:#F8FAFC; border-left:4px solid var(--emerald); padding:12px 16px; border-radius:8px; margin-bottom:16px;">
        <strong style="font-size:0.78rem; text-transform:uppercase; color:#047857; display:block; margin-bottom:6px;">⚡ Key Multi-Sport &amp; Collector Takeaways:</strong>
        <ul style="padding-left:18px; font-size:0.84rem; color:#1E293B;">
          ${article.takeaways.map(t => `<li style="margin-bottom:4px;">${t}</li>`).join("")}
        </ul>
      </div>

      <div style="font-size:0.88rem; color:#1E293B; line-height:1.65; margin-bottom:18px;">
        ${article.bodyHtml}
      </div>

      <!-- ZONE 3 + ZONE 5 inside Full Report Modal: Companion Story Locker + Natural Next Step 3-Piece Bundle Handoff -->
      <div style="background:#0A1120; color:#FFFFFF; border-radius:12px; padding:16px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
          <div>
            <strong style="font-family:var(--font-display); font-size:1.15rem; color:var(--gold); display:block;">🔒 THE STORY LOCKER &amp; YOUR NATURAL NEXT STEP</strong>
            <span style="font-size:0.76rem; color:#CBD5E1;">Explore the exact items mentioned in this report or pre-load the 3-piece look:</span>
          </div>
          <button type="button" class="wire-bundle-btn" style="flex:0 0 auto;" onclick="closeQuickView(); loadWireBundlePreset('${article.bundlePreset}');">
            ⚡ ${article.bundlePresetLabel}
          </button>
        </div>
        <div style="display:grid; gap:10px;">
          ${shopCardsHtml}
        </div>
      </div>

      <div style="font-size:0.72rem; color:#475569; background:#F1F5F9; padding:10px 12px; border-radius:8px;">
        <strong>Independent Editorial, Nominative Fair Use &amp; Affiliate Disclosure:</strong> The Press Box Wire is an independent sports news, sneaker authentication, and collector publication operated by <strong>Sun Marketing Enterprises LLC DBA Press Box Kicks &amp; Jerseys</strong> (<code>pressboxkicksjerseys.com</code> / <code>pressboxkicksandjerseys.com</code>). Team names, player names, uniform schedules, and sneaker model names are referenced strictly for editorial reporting, sizing education, and nominative fair-use identification of authentic merchandise under the First Amendment and 15 U.S.C. § 1114. Not affiliated with the NFL, NBA, MLB, Nike, Inc., Mitchell &amp; Ness, or New Era Cap Co. ${article.affiliateNote}
      </div>
    </div>
  `;
  modal.classList.add("open");
}

function loadWireBundlePreset(presetName) {
  applyBundlePreset(presetName);
  const el = document.getElementById("bundle-builder-section");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

document.addEventListener("DOMContentLoaded", () => {
  renderWireArticles("all");
  if (window.location.hash === "#news" || window.location.pathname === "/news") {
    const wireSec = document.getElementById("press-box-wire-section");
    if (wireSec) wireSec.scrollIntoView({ behavior: "smooth" });
  }
});
