/**
 * Car makes and their models — used for Make/Model dropdowns across the app.
 * Popular makes for the UAE/Middle East market.
 */
export const CAR_CATALOG = {
  'Toyota':        ['4Runner','Avalon','C-HR','Camry','Corolla','FJ Cruiser','Fortuner','GR86','Highlander','Hilux','Innova','Land Cruiser','Land Cruiser Prado','RAV4','Rush','Sequoia','Sienna','Tacoma','Tundra','Venza','Yaris'],
  'Nissan':        ['350Z','370Z','Altima','Armada','Frontier','GT-R','Juke','Kicks','Maxima','Murano','Navara','NV','Patrol','Pathfinder','Rogue','Sentra','Sunny','Tiida','Urvan','X-Trail'],
  'Honda':         ['Accord','BR-V','City','Civic','CR-V','CR-Z','Fit','Freed','HR-V','Insight','Jazz','Odyssey','Passport','Pilot','Ridgeline'],
  'Hyundai':       ['Accent','Azera','Creta','Elantra','Genesis','H1','Ioniq','Ioniq 5','Ioniq 6','Kona','Palisade','Santa Fe','Sonata','Staria','Tucson','Veloster'],
  'Kia':           ['Carnival','Cerato','EV6','K5','Niro','Optima','Picanto','Rio','Seltos','Sorento','Soul','Sportage','Stinger','Telluride'],
  'Mitsubishi':    ['ASX','Eclipse Cross','Galant','L200','Lancer','Mirage','Montero','Outlander','Pajero','Pajero Sport','Xpander'],
  'Mazda':         ['BT-50','CX-3','CX-30','CX-5','CX-9','Mazda2','Mazda3','Mazda6','MX-5'],
  'Suzuki':        ['Alto','Baleno','Carry','Ciaz','Ertiga','Grand Vitara','Jimny','S-Cross','Swift','Vitara'],
  'Isuzu':         ['D-Max','MU-X','Rodeo','Trooper'],
  'Ford':          ['Bronco','EcoSport','Edge','Escape','Expedition','Explorer','F-150','Fusion','Maverick','Mustang','Ranger','Taurus','Transit'],
  'Chevrolet':     ['Blazer','Camaro','Colorado','Corvette','Equinox','Impala','Malibu','Silverado','Spark','Suburban','Tahoe','Trailblazer','Traverse'],
  'GMC':           ['Acadia','Canyon','Envoy','Savana','Sierra','Terrain','Yukon','Yukon XL'],
  'Dodge':         ['Challenger','Charger','Dart','Durango','Journey','Ram 1500'],
  'RAM':           ['1500','2500','3500','ProMaster'],
  'Jeep':          ['Cherokee','Compass','Gladiator','Grand Cherokee','Grand Wagoneer','Renegade','Wrangler'],
  'BMW':           ['1 Series','2 Series','3 Series','4 Series','5 Series','6 Series','7 Series','8 Series','i4','iX','M2','M3','M4','M5','X1','X2','X3','X4','X5','X6','X7','Z4'],
  'Mercedes-Benz': ['A-Class','AMG GT','B-Class','C-Class','CLA','CLE','E-Class','EQC','EQE','EQS','G-Class','GLA','GLB','GLC','GLE','GLS','S-Class','Sprinter','V-Class','Vito'],
  'Audi':          ['A3','A4','A5','A6','A7','A8','e-tron','e-tron GT','Q2','Q3','Q5','Q7','Q8','R8','RS3','RS4','RS5','RS6','RS7','S3','S4','S5','TT'],
  'Volkswagen':    ['Amarok','Arteon','Atlas','Golf','ID.4','Jetta','Passat','Polo','T-Cross','T-Roc','Tiguan','Touareg','Touran','Transporter'],
  'Lexus':         ['ES','GS','GX','IS','LC','LS','LX','LM','NX','RC','RX','UX'],
  'Infiniti':      ['Q50','Q60','Q70','QX30','QX50','QX55','QX60','QX80'],
  'Land Rover':    ['Defender','Discovery','Discovery Sport','Freelander','Range Rover','Range Rover Evoque','Range Rover Sport','Range Rover Velar'],
  'Porsche':       ['911','Boxster','Cayenne','Cayman','Macan','Panamera','Taycan'],
  'Volvo':         ['C40','S60','S90','V60','V90','XC40','XC60','XC90'],
  'Jaguar':        ['E-Pace','F-Pace','F-Type','I-Pace','XE','XF','XJ'],
  'Cadillac':      ['CT4','CT5','Escalade','Escalade ESV','XT4','XT5','XT6'],
  'Lincoln':       ['Aviator','Corsair','Nautilus','Navigator'],
  'Peugeot':       ['2008','208','3008','308','408','5008','508','Expert','Partner'],
  'Renault':       ['Captur','Clio','Duster','Fluence','Koleos','Logan','Megane','Sandero','Trafic','Zoe'],
  'Subaru':        ['BRZ','Crosstrek','Forester','Impreza','Legacy','Outback','WRX','XV'],
  'MG':            ['3','5','6','GS','HS','RX5','ZS','ZS EV'],
  'Chery':         ['Arrizo 5','Arrizo 6','Tiggo 4','Tiggo 7','Tiggo 8'],
  'Geely':         ['Atlas','Coolray','Emgrand','Okavango','Tugella'],
  'BYD':           ['Atto 3','Han','Seal','Song','Tang'],
  'Maserati':      ['Ghibli','GranTurismo','Grecale','Levante','MC20','Quattroporte'],
  'Ferrari':       ['296 GTB','488','812','F8','GTC4Lusso','Portofino','Roma','SF90'],
  'Lamborghini':   ['Aventador','Huracán','Urus'],
  'Bentley':       ['Bentayga','Continental GT','Flying Spur','Mulsanne'],
  'Rolls-Royce':   ['Cullinan','Dawn','Ghost','Phantom','Spectre','Wraith'],
  'Other':         [],
};

/** Sorted list of all makes — use for the Make dropdown. */
export const CAR_MAKES = Object.keys(CAR_CATALOG);
