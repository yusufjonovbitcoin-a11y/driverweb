export const DRIVERS = [
  {
    id: 'd1',
    name: 'John Davis',
    driverNumber: '#1024',
    phone: '+1 (312) 555-0192',
    status: 'AVAILABLE', // AVAILABLE, ON_LOAD, RESTING
    dutyStatus: 'ON_DUTY', // ON_DUTY, DRIVING, SLEEPER, OFF_DUTY
    currentLocation: 'Chicago, IL',
    lat: 41.8781,
    lng: -87.6298,
    hos: {
      driveLeft: '08:45',
      shiftLeft: '11:15',
      cycleLeft: '56:30'
    },
    truck: 'Volvo VNL 860 (#702)',
    trailer: "53' Reefer (#R-881)",
    rating: 4.98,
    completedLoads: 142,
    onTimeRate: '99.2%',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'd2',
    name: 'Michael Chen',
    driverNumber: '#1032',
    phone: '+1 (415) 555-8831',
    status: 'ON_LOAD',
    dutyStatus: 'DRIVING',
    currentLocation: 'Indianapolis, IN',
    lat: 39.7684,
    lng: -86.1581,
    hos: {
      driveLeft: '04:15',
      shiftLeft: '06:30',
      cycleLeft: '32:10'
    },
    truck: 'Freightliner Cascadia (#504)',
    trailer: "53' Dry Van (#V-102)",
    rating: 4.92,
    completedLoads: 98,
    onTimeRate: '98.5%',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'd3',
    name: 'Alex Rivera',
    driverNumber: '#1045',
    phone: '+1 (214) 555-9012',
    status: 'AVAILABLE',
    dutyStatus: 'SLEEPER',
    currentLocation: 'Dallas, TX',
    lat: 32.7767,
    lng: -96.7970,
    hos: {
      driveLeft: '11:00',
      shiftLeft: '14:00',
      cycleLeft: '68:45'
    },
    truck: 'Peterbilt 579 (#309)',
    trailer: "53' Reefer (#R-412)",
    rating: 4.95,
    completedLoads: 116,
    onTimeRate: '100%',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'd4',
    name: 'David Miller',
    driverNumber: '#1051',
    phone: '+1 (770) 555-4321',
    status: 'RESTING',
    dutyStatus: 'OFF_DUTY',
    currentLocation: 'Atlanta, GA',
    lat: 33.7490,
    lng: -84.3880,
    hos: {
      driveLeft: '00:00',
      shiftLeft: '00:00',
      cycleLeft: '44:20'
    },
    truck: 'Kenworth T680 (#812)',
    trailer: "53' Flatbed (#F-009)",
    rating: 4.88,
    completedLoads: 84,
    onTimeRate: '97.6%',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80'
  }
];

export const INITIAL_LOADS = [
  {
    id: 'load-78421',
    loadNumber: '#LD-78421',
    status: 'ASSIGNED', // OFFER, ASSIGNED, IN_TRANSIT, DELIVERED, COMPLETED
    broker: 'C.H. Robinson',
    brokerContact: 'Michael Scott',
    brokerPhone: '+1 (800) 323-7707',
    rate: 2850,
    distanceMiles: 920,
    ratePerMile: 3.10,
    origin: {
      city: 'Chicago',
      state: 'IL',
      facility: 'ABC Distribution Hub',
      address: '1234 Industrial Blvd, Chicago, IL 60601',
      date: '2026-10-12',
      time: '08:00 - 10:00 AM',
      lat: 41.8781,
      lng: -87.6298
    },
    destination: {
      city: 'Dallas',
      state: 'TX',
      facility: 'Dallas Logistics Center',
      address: '8800 Logistics Way, Dallas, TX 75201',
      date: '2026-10-15',
      time: '17:00 - 19:00 PM',
      lat: 32.7767,
      lng: -96.7970
    },
    commodity: 'Свежие фрукты & ягоды',
    weightLbs: 42000,
    equipment: "53' Reefer",
    temperature: '-10°C (14°F)',
    pallets: 26,
    driverId: 'd1',
    dispatchedAt: '10 daqiqa oldin',
    documents: {
      rateCon: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop&q=80',
      shipperBol: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&auto=format&fit=crop&q=80',
      receiverPod: null
    }
  },
  {
    id: 'load-99201',
    loadNumber: '#LD-99201',
    status: 'IN_TRANSIT',
    broker: 'TQL Logistics',
    brokerContact: 'Sarah Jenkins',
    brokerPhone: '+1 (800) 580-3101',
    rate: 3400,
    distanceMiles: 1100,
    ratePerMile: 3.09,
    origin: {
      city: 'Atlanta',
      state: 'GA',
      facility: 'Southern Freight Terminal',
      address: '400 Transport Ave, Atlanta, GA 30301',
      date: '2026-10-14',
      time: '09:00 - 11:00 AM',
      lat: 33.7490,
      lng: -84.3880
    },
    destination: {
      city: 'Philadelphia',
      state: 'PA',
      facility: 'Keystone Supply Depot',
      address: '220 Harbor Blvd, Philadelphia, PA 19104',
      date: '2026-10-17',
      time: '14:00 - 16:00 PM',
      lat: 39.9526,
      lng: -75.1652
    },
    commodity: 'Автозапчасти & электроника',
    weightLbs: 38500,
    equipment: "53' Dry Van",
    temperature: null,
    pallets: 24,
    driverId: 'd2',
    dispatchedAt: '2 soat oldin',
    documents: {
      rateCon: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop&q=80',
      shipperBol: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&auto=format&fit=crop&q=80',
      receiverPod: null
    }
  },
  {
    id: 'load-65103',
    loadNumber: '#LD-65103',
    status: 'DELIVERED',
    broker: 'Echo Global Logistics',
    brokerContact: 'David Cooper',
    brokerPhone: '+1 (800) 354-7993',
    rate: 4100,
    distanceMiles: 1420,
    ratePerMile: 2.89,
    origin: {
      city: 'Seattle',
      state: 'WA',
      facility: 'Pacific Rim Gateway',
      address: '100 Alaskan Way, Seattle, WA 98101',
      date: '2026-10-08',
      time: '07:00 - 09:00 AM',
      lat: 47.6062,
      lng: -122.3321
    },
    destination: {
      city: 'Denver',
      state: 'CO',
      facility: 'Rocky Mountain Hub',
      address: '7700 I-70 Frontage, Denver, CO 80201',
      date: '2026-10-11',
      time: '12:00 - 14:00 PM',
      lat: 39.7392,
      lng: -104.9903
    },
    commodity: 'Фармацевтика & медикаменты',
    weightLbs: 29000,
    equipment: "53' Reefer",
    temperature: '2°C to 8°C',
    pallets: 18,
    driverId: 'd3',
    dispatchedAt: '1 kun oldin',
    documents: {
      rateCon: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop&q=80',
      shipperBol: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&auto=format&fit=crop&q=80',
      receiverPod: 'https://images.unsplash.com/photo-1618042164219-62c820f10723?w=700&auto=format&fit=crop&q=80'
    }
  },
  {
    id: 'load-31049',
    loadNumber: '#LD-31049',
    status: 'COMPLETED',
    broker: 'Landstar Ranger',
    brokerContact: 'Elena Rostova',
    brokerPhone: '+1 (800) 872-9400',
    rate: 1950,
    distanceMiles: 620,
    ratePerMile: 3.15,
    origin: {
      city: 'Columbus',
      state: 'OH',
      facility: 'Midwest Steel Logistics',
      address: '500 Ironworks Rd, Columbus, OH 43215',
      date: '2026-10-05',
      time: '10:00 - 12:00 PM',
      lat: 39.9612,
      lng: -82.9988
    },
    destination: {
      city: 'Charlotte',
      state: 'NC',
      facility: 'Carolina Distribution',
      address: '1100 Queen City Way, Charlotte, NC 28202',
      date: '2026-10-06',
      time: '18:00 - 20:00 PM',
      lat: 35.2271,
      lng: -80.8431
    },
    commodity: 'Строительные материалы',
    weightLbs: 45000,
    equipment: "53' Flatbed",
    temperature: null,
    pallets: 20,
    driverId: 'd4',
    dispatchedAt: '3 kun oldin',
    documents: {
      rateCon: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop&q=80',
      shipperBol: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&auto=format&fit=crop&q=80',
      receiverPod: 'https://images.unsplash.com/photo-1618042164219-62c820f10723?w=700&auto=format&fit=crop&q=80'
    }
  }
];

export const MOCK_BROKERS = [
  'C.H. Robinson',
  'TQL (Total Quality Logistics)',
  'Echo Global Logistics',
  'Landstar Ranger',
  'Coyote Logistics',
  'Arrive Logistics',
  'RXO Logistics'
];
