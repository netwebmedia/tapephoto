// _deploy/build-llms.js
// Regenerates llms.txt (newest 20 posts) and llms-full.txt (every post) from
// _deploy/blog-index.json so the post list never goes stale when the blog
// publisher adds articles. Called from blog-publish.js; also runnable alone:
//   node _deploy/build-llms.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://tapephoto.com';

function header(total) {
  return `# TapePhoto

> TapePhoto (tapephoto.com) is the photography site of Carlos Martinez, a photographer based in Coquimbo, Chile. The portfolio covers motorsport, concerts, aerial drone, street and travel photography; the services pages cover photography for businesses, hotels and tourism, and real estate in La Serena, Coquimbo and the Coquimbo Region. The portfolio is in English; the local-business pages and the blog are in Spanish.

## About
- Author: Carlos Martinez, photographer (Coquimbo, Chile). Instagram: https://instagram.com/tapephotocom
- Contact: carlos@netwebmedia.com · WhatsApp +1 (442) 385-4585 (https://wa.me/14423854585)
- Pricing published on the site: "starting at" CLP $100,000 (aerial and drone), CLP $150,000 (real estate photo + drone package), CLP $250,000 (motorsport and event coverage), CLP $150,000 (business and brand sessions); final quote via WhatsApp.
- ${total} Spanish-language blog articles published so far.

## Main pages
- [Home / portfolio](${SITE}/): selected work, local business photography overview, FAQ
- [Services (English)](${SITE}/services.html): four services with starting prices and FAQ
- [Servicios (Español)](${SITE}/servicios.html): the same services in Spanish
- [Fotografía inmobiliaria en La Serena y Coquimbo](${SITE}/fotografia-inmobiliaria-la-serena.html): interiors, exteriors and drone in one visit, for brokers and real estate firms
- [Fotografía para hoteles y cabañas en La Serena](${SITE}/fotografia-hoteles-turismo-la-serena.html): rooms, common areas and aerials, ready for Booking and social media
- [Fotografía para empresas en La Serena y Coquimbo](${SITE}/fotografia-empresas-la-serena.html): team, premises and product photography instead of stock images
- [Galleries](${SITE}/galleries/): 17 curated photo galleries in six categories — Motorsport (WRC Rally Chile 2019, rally raid in the Atacama, Grand Prix of Long Beach 2018, ISDE enduro, MTB enduro), Events (Del Mar Opening Day, Hermosa Beach St. Patrick's parade, Lebowski Fest, poker tour, live music), Portraits, Street & Cities (Playas de Tijuana, San Francisco & Los Angeles, Las Vegas nights), Aerial & Drone, Landscapes & Travel (Andes & glaciers; coast, travel & wildlife)
- [About](${SITE}/about.html) · [Contact](${SITE}/contact.html) · [Contacto](${SITE}/contacto.html)
- [Blog (Spanish)](${SITE}/blog/): practical guides for businesses, hotels and real estate brokers
`;
}

function build() {
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, '_deploy', 'blog-index.json'), 'utf8'));
  const items = db.items || [];
  const line = p => `- [${p.title}](${SITE}/blog/${p.slug}.html)${p.tag ? ' [' + p.tag + ']' : ''}${p.description ? ': ' + p.description : ''}`;
  const short = header(items.length) + `\n## Latest blog articles (Spanish, newest first)\n\n` + items.slice(0, 20).map(line).join('\n') +
    `\n\n## More\n- Every article, one line each: ${SITE}/llms-full.txt\n- Sitemap: ${SITE}/sitemap.xml\n`;
  const full = header(items.length) + `\n## All blog articles (Spanish, newest first)\n\n` + items.map(line).join('\n') + `\n\n## More\n- Sitemap: ${SITE}/sitemap.xml\n`;
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), short);
  fs.writeFileSync(path.join(ROOT, 'llms-full.txt'), full);
  console.log(`build-llms: ${items.length} posts -> llms.txt (20), llms-full.txt (all)`);
}

module.exports = { build };
if (require.main === module) build();
