'use strict';

/**
 * Location and Education Data Service
 * Provides comprehensive worldwide and Indian state/city/college datasets.
 */

const ALL_INDIAN_STATES_AND_UTS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi / NCR", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

const ALL_WORLD_COUNTRIES = [
  "India", "United States", "USA", "United Kingdom", "Canada", "Australia", "Germany",
  "United Arab Emirates", "Singapore", "France", "Japan", "China", "Brazil",
  "South Africa", "Netherlands", "Switzerland", "Spain", "Italy", "Sweden",
  "Ireland", "New Zealand", "Saudi Arabia", "Qatar", "Kuwait", "Oman",
  "Malaysia", "Indonesia", "Vietnam", "Philippines", "Thailand", "Mexico",
  "Argentina", "Egypt", "Nigeria", "Kenya", "South Korea", "Russia", "Turkey"
];

const STATE_CITY_MAP = {
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Kolhapur", "Satara", "Aurangabad", "Solapur", "Thane", "Navi Mumbai", "Sangli", "Amravati", "Nanded", "Latur", "Akola", "Jalgaon", "Ahmednagar"],
  "Karnataka": ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Tumakuru", "Shivamogga", "Davangere", "Ballari", "Kalaburagi"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Kanchipuram", "Tirunelveli", "Vellore", "Erode", "Thanjavur"],
  "Delhi / NCR": ["New Delhi", "Noida", "Gurugram", "Faridabad", "Ghaziabad", "Greater Noida"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Noida", "Greater Noida", "Prayagraj", "Meerut", "Ghaziabad", "Bareilly", "Aligarh", "Gorakhpur"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Junagadh"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Siliguri", "Asansol", "Kharagpur"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Bhilwara"],
  "Punjab": ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali"],
  "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Karnal", "Hisar", "Rohtak"],
  "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kannur"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain", "Sagar"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kakinada", "Kurnool"],
  "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Purnea"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa"]
};

const STATE_COLLEGE_MAP = {
  "Maharashtra": [
    "College of Engineering Pune (COEP)", "Pune Institute of Computer Technology (PICT)",
    "MIT World Peace University (MIT-WPU)", "Vishwakarma Institute of Technology (VIT Pune)",
    "D.Y. Patil College of Engineering", "Veermata Jijabai Technological Institute (VJTI Mumbai)",
    "Indian Institute of Technology Bombay (IIT Bombay)", "Government College of Engineering Aurangabad",
    "Walchand College of Engineering Sangli", "NMIMS Mumbai", "SPIT Mumbai", "K.J. Somaiya College of Engineering",
    "Savitribai Phule Pune University (SPPU)", "Mumbai University"
  ],
  "Karnataka": [
    "Indian Institute of Science (IISc Bengaluru)", "RV College of Engineering (RVCE)",
    "BMS College of Engineering", "Ramaiah Institute of Technology (MSRIT)", "PES University",
    "International Institute of Information Technology Bangalore (IIITB)", "NIT Surathkal",
    "Manipal Institute of Technology", "Dayananda Sagar College of Engineering"
  ],
  "Tamil Nadu": [
    "SRM Institute of Science and Technology (SRM IST)", "College of Engineering Guindy (Anna University)",
    "Indian Institute of Technology Madras (IIT Madras)", "PSG College of Technology",
    "Vellore Institute of Technology (VIT Vellore)", "SASTRA Deemed University", "SSN College of Engineering",
    "NIT Trichy", "Sathyabama Institute of Science and Technology"
  ],
  "Delhi / NCR": [
    "Indian Institute of Technology Delhi (IIT Delhi)", "Delhi Technological University (DTU)",
    "Netaji Subhas University of Technology (NSUT)", "Indraprastha Institute of Information Technology (IIIT Delhi)",
    "Amity University Noida", "Jamia Millia Islamia", "Jawaharlal Nehru University (JNU)",
    "Guru Gobind Singh Indraprastha University (GGSIPU)"
  ],
  "Telangana": [
    "International Institute of Information Technology Hyderabad (IIIT Hyderabad)", "IIT Hyderabad",
    "JNTU Hyderabad", "Chaitanya Bharathi Institute of Technology (CBIT)", "Vasavi College of Engineering",
    "Osmania University"
  ],
  "Uttar Pradesh": [
    "IIT Kanpur", "IIT (BHU) Varanasi", "MNNIT Prayagraj", "Harcourt Butler Technical University (HBTU Kanpur)",
    "Jaypee Institute of Information Technology (JIIT Noida)", "GL Bajaj Institute of Technology",
    "AKTU Lucknow", "BHU Varanasi"
  ],
  "Gujarat": [
    "IIT Gandhinagar", "SVNIT Surat", "DA-IICT Gandhinagar", "Nirma University Ahmedabad", "MS University Vadodara"
  ],
  "West Bengal": [
    "IIT Kharagpur", "Jadavpur University Kolkata", "IIEST Shibpur", "Heritage Institute of Technology", "Techno India University"
  ],
  "Rajasthan": [
    "BITS Pilani", "MNIT Jaipur", "IIT Jodhpur", "LNM Institute of Information Technology (LNMIIT)", "Manipal University Jaipur"
  ]
};

const DEFAULT_DEGREES = [
  "B.Tech Computer Science & Engineering",
  "B.Tech Information Technology",
  "B.Tech AI & Data Science",
  "B.Tech Electronics & Communication",
  "B.Tech Mechanical Engineering",
  "B.Tech Civil Engineering",
  "B.Tech Chemical Engineering",
  "BCA (Bachelor of Computer Applications)",
  "MCA (Master of Computer Applications)",
  "B.Sc Computer Science",
  "M.Sc Computer Science",
  "BBA (Bachelor of Business Administration)",
  "MBA (Master of Business Administration)",
  "M.Tech Software Engineering",
  "Ph.D. Computer Science / Engineering",
  "Other / Custom Degree"
];

const POPULAR_SKILLS = [
  "Python", "JavaScript", "React", "Node.js", "Flutter", "Java", "C++", "C#",
  "HTML5", "CSS3", "TypeScript", "Express.js", "MongoDB", "SQL", "PostgreSQL",
  "Machine Learning", "Deep Learning", "Artificial Intelligence", "Data Analytics",
  "Pandas", "NumPy", "TensorFlow", "PyTorch", "Docker", "Kubernetes", "AWS",
  "Git & GitHub", "Figma", "UI/UX Design", "REST APIs", "GraphQL", "Tailwind CSS",
  "Android", "iOS / Swift", "Cyber Security", "DevOps", "CI/CD", "Next.js"
];

function getCountries() {
  return ALL_WORLD_COUNTRIES;
}

function getStates(countryName) {
  if (!countryName || countryName.toLowerCase() === 'india') {
    return ALL_INDIAN_STATES_AND_UTS;
  }
  if (countryName.toLowerCase().includes('united states') || countryName.toLowerCase() === 'usa') {
    return ["California", "New York", "Texas", "Massachusetts", "Washington", "Illinois", "Florida", "Pennsylvania"];
  }
  if (countryName.toLowerCase().includes('united kingdom') || countryName.toLowerCase() === 'uk') {
    return ["Greater London", "Oxfordshire", "Cambridgeshire", "Greater Manchester", "Scotland"];
  }
  return ["State / Region 1", "State / Region 2", "Capital Territory", "Other Region"];
}

function getCities(countryName, stateName) {
  if (STATE_CITY_MAP[stateName]) {
    return STATE_CITY_MAP[stateName];
  }
  return ["Capital City", "Central District", "North City", "South City", "Other City"];
}

function getColleges(stateName) {
  if (STATE_COLLEGE_MAP[stateName]) {
    return STATE_COLLEGE_MAP[stateName];
  }
  return [
    "Government Engineering College",
    "National Institute of Technology (NIT)",
    "Indian Institute of Technology (IIT)",
    "State University",
    "Private Autonomous College",
    "Other College / University"
  ];
}

function getDegrees() {
  return DEFAULT_DEGREES;
}

function searchSkills(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return POPULAR_SKILLS.slice(0, 20);
  return POPULAR_SKILLS.filter(s => s.toLowerCase().includes(q));
}

module.exports = {
  getCountries,
  getStates,
  getCities,
  getColleges,
  getDegrees,
  searchSkills,
  ALL_INDIAN_STATES_AND_UTS,
  ALL_WORLD_COUNTRIES
};
