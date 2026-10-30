// Serves the built storefront locally: node scripts/serve-storefront.js [port]
import express from 'express';

const port = Number(process.argv[2] || process.env.PORT || 4321);
const dist = new URL('../shopify/storefront/dist/', import.meta.url).pathname;
const app = express();
app.use(express.static(dist, { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile('404.html', { root: dist }));
app.listen(port, () => console.log(`Storefront at http://localhost:${port}`));
