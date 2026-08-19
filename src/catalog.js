// Definisi 8 halaman katalog produk Nifara Store
// Setiap halaman = 1 kategori produk dengan beberapa paket

export const CATALOG_PAGES = [
  {
    id: 1,
    emoji: "✨",
    title: "Netflix Premium",
    subtitle: "Streaming film & series HD tanpa batas",
    products: [
      { name: "Netflix 1 Bulan", price: 45000, duration: "30 hari", desc: "Private 4K UHD, semua perangkat" },
      { name: "Netflix 3 Bulan", price: 120000, duration: "90 hari", desc: "Hemat 11%, private 4K UHD" },
      { name: "Netflix 1 Tahun", price: 420000, duration: "365 hari", desc: "Paling hemat, private 4K UHD" },
    ],
  },
  {
    id: 2,
    emoji: "🎵",
    title: "Spotify Premium",
    subtitle: "Musik tanpa iklan, download offline",
    products: [
      { name: "Spotify 1 Bulan", price: 25000, duration: "30 hari", desc: "Individual, tanpa iklan, offline" },
      { name: "Spotify 3 Bulan", price: 65000, duration: "90 hari", desc: "Hemat 13%, individual" },
      { name: "Spotify 1 Tahun", price: 220000, duration: "365 hari", desc: "Harga terbaik, individual" },
    ],
  },
  {
    id: 3,
    emoji: "🤖",
    title: "ChatGPT Plus",
    subtitle: "GPT-4, DALL·E, plugin & lebih cepat",
    products: [
      { name: "ChatGPT Plus 1 Bulan", price: 150000, duration: "30 hari", desc: "Akses GPT-4, DALL·E 3, browsing" },
      { name: "ChatGPT Plus 3 Bulan", price: 420000, duration: "90 hari", desc: "Hemat 7%, semua fitur Plus" },
    ],
  },
  {
    id: 4,
    emoji: "🎬",
    title: "Disney+ Hotstar",
    subtitle: "Marvel, Star Wars, anime & olahraga live",
    products: [
      { name: "Disney+ 1 Bulan", price: 35000, duration: "30 hari", desc: "4K, semua konten eksklusif" },
      { name: "Disney+ 3 Bulan", price: 95000, duration: "90 hari", desc: "Hemat 10%, 4K" },
      { name: "Disney+ 1 Tahun", price: 320000, duration: "365 hari", desc: "Harga terbaik, 4K" },
    ],
  },
  {
    id: 5,
    emoji: "☁️",
    title: "Google One / iCloud",
    subtitle: "Penyimpanan cloud tambahan",
    products: [
      { name: "Google One 100GB 1 Bln", price: 20000, duration: "30 hari", desc: "100 GB Google Drive, Gmail, Foto" },
      { name: "Google One 200GB 1 Bln", price: 32000, duration: "30 hari", desc: "200 GB, cocok untuk keluarga" },
      { name: "iCloud+ 50GB 1 Bln", price: 18000, duration: "30 hari", desc: "50 GB iCloud untuk iPhone/iPad" },
      { name: "iCloud+ 200GB 1 Bln", price: 30000, duration: "30 hari", desc: "200 GB, bisa share ke keluarga" },
    ],
  },
  {
    id: 6,
    emoji: "🎮",
    title: "Gaming",
    subtitle: "Xbox Game Pass, PlayStation Plus & Steam",
    products: [
      { name: "Xbox Game Pass 1 Bln", price: 85000, duration: "30 hari", desc: "Ultimate: 400+ game, EA Play, cloud" },
      { name: "PS Plus Essential 1 Bln", price: 80000, duration: "30 hari", desc: "2–3 game gratis/bulan, online" },
      { name: "PS Plus Extra 1 Bln", price: 120000, duration: "30 hari", desc: "Katalog 400+ game PS4/PS5" },
    ],
  },
  {
    id: 7,
    emoji: "🛠️",
    title: "Tools Produktivitas",
    subtitle: "Canva, Microsoft 365, Notion & Adobe",
    products: [
      { name: "Canva Pro 1 Bulan", price: 55000, duration: "30 hari", desc: "Template premium, background remover" },
      { name: "Canva Pro 1 Tahun", price: 180000, duration: "365 hari", desc: "Hemat 73%, semua fitur Pro" },
      { name: "Microsoft 365 1 Bln", price: 60000, duration: "30 hari", desc: "Word, Excel, PPT, 1 TB OneDrive" },
      { name: "Notion AI 1 Bulan", price: 70000, duration: "30 hari", desc: "Unlimited AI, workspace Plus" },
    ],
  },
  {
    id: 8,
    emoji: "🌐",
    title: "VPN & Keamanan",
    subtitle: "Browsing aman, bypass blokir, privasi",
    products: [
      { name: "NordVPN 1 Bulan", price: 75000, duration: "30 hari", desc: "6 perangkat, 60+ negara, cepat" },
      { name: "NordVPN 1 Tahun", price: 250000, duration: "365 hari", desc: "Hemat 72%, termasuk threat protection" },
      { name: "ExpressVPN 1 Bulan", price: 80000, duration: "30 hari", desc: "5 perangkat, 90+ negara, tercepat" },
    ],
  },
];
