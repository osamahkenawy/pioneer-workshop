/* ── Country → Regions/Subdivisions mapping ── */
export const COUNTRY_REGIONS = {
  'United Arab Emirates': ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'],
  'Saudi Arabia': ['Riyadh','Makkah','Madinah','Eastern Province','Asir','Tabuk','Hail','Northern Borders','Jazan','Najran','Al Baha','Al Jawf','Qassim'],
  'Kuwait': ['Al Asimah','Hawalli','Farwaniya','Mubarak Al-Kabeer','Ahmadi','Jahra'],
  'Bahrain': ['Capital','Muharraq','Northern','Southern'],
  'Oman': ['Muscat','Dhofar','Al Batinah North','Al Batinah South','Al Dakhiliyah','Al Sharqiyah North','Al Sharqiyah South','Al Dhahirah','Al Buraimi','Musandam','Al Wusta'],
  'Qatar': ['Doha','Al Rayyan','Al Wakrah','Al Khor','Al Shamal','Umm Salal','Al Daayen','Al Shahaniya'],
  'Jordan': ['Amman','Irbid','Zarqa','Balqa','Mafraq','Karak','Tafilah','Ma\'an','Ajloun','Jerash','Madaba','Aqaba'],
  'Egypt': ['Cairo','Giza','Alexandria','Qalyubia','Dakahlia','Sharqia','Gharbia','Monufia','Beheira','Kafr El Sheikh','Damietta','Port Said','Ismailia','Suez','North Sinai','South Sinai','Red Sea','Aswan','Luxor','Qena','Sohag','Asyut','Minya','Beni Suef','Fayoum','New Valley','Matrouh'],
  'Iraq': ['Baghdad','Basra','Nineveh','Erbil','Sulaymaniyah','Duhok','Kirkuk','Diyala','Anbar','Najaf','Karbala','Babil','Wasit','Maysan','Dhi Qar','Muthanna','Qadisiyyah','Saladin'],
  'Lebanon': ['Beirut','Mount Lebanon','North Lebanon','South Lebanon','Bekaa','Baalbek-Hermel','Akkar','Nabatieh'],
  'United States': ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'],
  'United Kingdom': ['England','Scotland','Wales','Northern Ireland'],
  'India': ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi'],
  'Pakistan': ['Punjab','Sindh','Khyber Pakhtunkhwa','Balochistan','Islamabad','Gilgit-Baltistan','Azad Kashmir'],
  'Turkey': ['Istanbul','Ankara','Izmir','Antalya','Bursa','Adana','Konya','Gaziantep','Mersin','Kayseri','Diyarbakır'],
  'Morocco': ['Casablanca-Settat','Rabat-Salé-Kénitra','Tanger-Tétouan-Al Hoceïma','Fès-Meknès','Marrakech-Safi','Souss-Massa','Drâa-Tafilalet','Béni Mellal-Khénifra','Oriental','Guelmim-Oued Noun','Laâyoune-Sakia El Hamra','Dakhla-Oued Ed-Dahab'],
  'Tunisia': ['Tunis','Ariana','Ben Arous','Manouba','Sousse','Sfax','Nabeul','Monastir','Bizerte','Gabès','Kairouan','Médenine'],
};

/* ── Country → Region label (en/ar) ── */
export const COUNTRY_REGION_LABEL = {
  'United Arab Emirates': { en: 'Emirate', ar: 'الإمارة' },
  'Saudi Arabia': { en: 'Province', ar: 'المنطقة' },
  'Kuwait': { en: 'Governorate', ar: 'المحافظة' },
  'Bahrain': { en: 'Governorate', ar: 'المحافظة' },
  'Oman': { en: 'Governorate', ar: 'المحافظة' },
  'Qatar': { en: 'Municipality', ar: 'البلدية' },
  'Jordan': { en: 'Governorate', ar: 'المحافظة' },
  'Egypt': { en: 'Governorate', ar: 'المحافظة' },
  'Iraq': { en: 'Governorate', ar: 'المحافظة' },
  'Lebanon': { en: 'Governorate', ar: 'المحافظة' },
  'United States': { en: 'State', ar: 'الولاية' },
  'United Kingdom': { en: 'Region', ar: 'المنطقة' },
  'India': { en: 'State', ar: 'الولاية' },
  'Pakistan': { en: 'Province', ar: 'المقاطعة' },
  'Turkey': { en: 'Province', ar: 'المحافظة' },
  'Morocco': { en: 'Region', ar: 'الجهة' },
  'Tunisia': { en: 'Governorate', ar: 'الولاية' },
};

/** Get the regions list for a country. WarrantyClaims empty array if country has no predefined regions. */
export function getRegions(country) {
  return COUNTRY_REGIONS[country] || [];
}

/** Get the localized label for the region field (e.g. "Emirate", "Province", "State"). */
export function getRegionLabel(country, lang = 'en') {
  const entry = COUNTRY_REGION_LABEL[country];
  if (entry) return entry[lang] || entry.en;
  return lang === 'ar' ? 'المنطقة' : 'Region';
}

/* ── Country → Geographic center [lat, lng] ── */
export const COUNTRY_CENTERS = {
  'United Arab Emirates': [24.4539, 54.3773],
  'Saudi Arabia': [23.8859, 45.0792],
  'Kuwait': [29.3117, 47.4818],
  'Bahrain': [26.0667, 50.5577],
  'Oman': [21.4735, 55.9754],
  'Qatar': [25.3548, 51.1839],
  'Jordan': [31.9454, 35.9284],
  'Egypt': [26.8206, 30.8025],
  'Iraq': [33.2232, 43.6793],
  'Lebanon': [33.8547, 35.8623],
  'United States': [37.0902, -95.7129],
  'United Kingdom': [55.3781, -3.4360],
  'India': [20.5937, 78.9629],
  'Pakistan': [30.3753, 69.3451],
  'Turkey': [38.9637, 35.2433],
  'Morocco': [31.7917, -7.0926],
  'Tunisia': [33.8869, 9.5375],
  'Argentina': [-38.4161, -63.6167],
  'Brazil': [-14.2350, -51.9253],
  'Mexico': [23.6345, -102.5528],
  'Germany': [51.1657, 10.4515],
  'France': [46.2276, 2.2137],
  'Spain': [40.4637, -3.7492],
  'Italy': [41.8719, 12.5674],
  'Canada': [56.1304, -106.3468],
  'Australia': [-25.2744, 133.7751],
  'South Africa': [-30.5595, 22.9375],
  'Nigeria': [9.0820, 8.6753],
  'Kenya': [-0.0236, 37.9062],
  'Japan': [36.2048, 138.2529],
  'South Korea': [35.9078, 127.7669],
  'China': [35.8617, 104.1954],
  'Indonesia': [-0.7893, 113.9213],
  'Malaysia': [4.2105, 101.9758],
  'Philippines': [12.8797, 121.7740],
  'Thailand': [15.8700, 100.9925],
  'Singapore': [1.3521, 103.8198],
};

/** Get map center for a country. Uses company lat/lng if available, else country center, else UAE. */
export function getCountryCenter(country, companyLat, companyLng) {
  if (companyLat && companyLng) return [parseFloat(companyLat), parseFloat(companyLng)];
  return COUNTRY_CENTERS[country] || COUNTRY_CENTERS['United Arab Emirates'];
}
