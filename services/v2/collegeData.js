'use strict';

/**
 * Where Indian students actually studied, as a list to pick from.
 *
 * "Which college?" was a text box, and a text box is where an interview goes
 * to die — it is also where the parser gets it wrong, because a student types
 * "kiit bbsr" or "IIT-M" and the page ends up with something no recruiter
 * searches for. These are the institutions by name, grouped the way a student
 * thinks about them, so picking takes a second and the page carries the name
 * the institution itself uses.
 *
 * The ordering is the NIRF bands, because that is the ranking Indian students
 * recognise and it puts the most likely answers at the top of the list. It is
 * not a judgement about anybody: every list here ends with the free-text
 * escape, and a college nobody thought of is one click and one line away.
 *
 * Rankings move every year. Nothing downstream depends on the order.
 */

const COLLEGE_GROUPS = [
  {
    group: 'IITs',
    colleges: [
      'Indian Institute of Technology Madras',
      'Indian Institute of Technology Bombay',
      'Indian Institute of Technology Delhi',
      'Indian Institute of Technology Kanpur',
      'Indian Institute of Technology Kharagpur',
      'Indian Institute of Technology Roorkee',
      'Indian Institute of Technology Guwahati',
      'Indian Institute of Technology Hyderabad',
      'Indian Institute of Technology (BHU) Varanasi',
      'Indian Institute of Technology Indore',
      'Indian Institute of Technology (ISM) Dhanbad',
      'Indian Institute of Technology Gandhinagar',
      'Indian Institute of Technology Ropar',
      'Indian Institute of Technology Patna',
      'Indian Institute of Technology Bhubaneswar',
      'Indian Institute of Technology Mandi',
      'Indian Institute of Technology Jodhpur',
      'Indian Institute of Technology Tirupati',
      'Indian Institute of Technology Palakkad',
      'Indian Institute of Technology Jammu',
      'Indian Institute of Technology Bhilai',
      'Indian Institute of Technology Goa',
      'Indian Institute of Technology Dharwad',
    ],
  },
  {
    group: 'NITs and IIITs',
    colleges: [
      'National Institute of Technology Tiruchirappalli',
      'National Institute of Technology Surathkal',
      'National Institute of Technology Rourkela',
      'National Institute of Technology Warangal',
      'National Institute of Technology Calicut',
      'National Institute of Technology Durgapur',
      'National Institute of Technology Silchar',
      'National Institute of Technology Kurukshetra',
      'National Institute of Technology Jaipur (MNIT)',
      'National Institute of Technology Allahabad (MNNIT)',
      'National Institute of Technology Bhopal (MANIT)',
      'National Institute of Technology Nagpur (VNIT)',
      'National Institute of Technology Jamshedpur',
      'National Institute of Technology Patna',
      'National Institute of Technology Raipur',
      'National Institute of Technology Srinagar',
      'International Institute of Information Technology Hyderabad',
      'Indian Institute of Information Technology Allahabad',
      'Indian Institute of Information Technology Bangalore',
      'Indian Institute of Information Technology Gwalior',
      'Indraprastha Institute of Information Technology Delhi',
    ],
  },
  {
    group: 'Central and state universities',
    colleges: [
      'Indian Institute of Science, Bengaluru',
      'Jawaharlal Nehru University, New Delhi',
      'University of Delhi',
      'Banaras Hindu University',
      'Jamia Millia Islamia',
      'Aligarh Muslim University',
      'Jadavpur University',
      'University of Hyderabad',
      'Anna University',
      'Panjab University',
      'Savitribai Phule Pune University',
      'University of Calcutta',
      'University of Mumbai',
      'Osmania University',
      'Andhra University',
      'Cochin University of Science and Technology',
      'Visvesvaraya Technological University',
      'Delhi Technological University',
      'Netaji Subhas University of Technology',
      'Homi Bhabha National Institute',
    ],
  },
  {
    group: 'Private universities and institutes',
    colleges: [
      'Birla Institute of Technology and Science, Pilani',
      'Vellore Institute of Technology',
      'SRM Institute of Science and Technology',
      'Manipal Academy of Higher Education',
      'Manipal Institute of Technology',
      'Amrita Vishwa Vidyapeetham',
      'Kalinga Institute of Industrial Technology (KIIT)',
      'Siksha O Anusandhan University',
      'Thapar Institute of Engineering and Technology',
      'Amity University',
      'Chandigarh University',
      'Lovely Professional University',
      'SASTRA Deemed University',
      'UPES Dehradun',
      'Birla Institute of Technology, Mesra',
      'Graphic Era University',
      'KL University',
      'Kalasalingam Academy of Research and Education',
      'Shiv Nadar University',
      'Ashoka University',
      'PES University',
      'RV College of Engineering',
      'BMS College of Engineering',
      'MS Ramaiah Institute of Technology',
      'Christ University',
      'Symbiosis Institute of Technology',
      'Vidyalankar Institute of Technology',
      'Nirma University',
      'GLA University',
      'Galgotias University',
      'Bennett University',
      'SRM University AP',
      'Manipal University Jaipur',
    ],
  },
  {
    group: 'Other well-known colleges',
    colleges: [
      'College of Engineering Pune',
      'PSG College of Technology',
      'Coimbatore Institute of Technology',
      'Thiagarajar College of Engineering',
      'Government College of Technology, Coimbatore',
      'Maharaja Sayajirao University of Baroda',
      'Institute of Chemical Technology, Mumbai',
      'Veermata Jijabai Technological Institute (VJTI)',
      'Sardar Vallabhbhai National Institute of Technology, Surat',
      'Motilal Nehru National Institute of Technology',
      'Harcourt Butler Technical University',
      'Madan Mohan Malaviya University of Technology',
      'Dr. B. R. Ambedkar National Institute of Technology, Jalandhar',
      'Punjab Engineering College',
      'Jaypee Institute of Information Technology',
      'Maulana Azad National Institute of Technology',
      'Hindu College, Delhi',
      'St. Stephen\'s College, Delhi',
      'Miranda House, Delhi',
      'Hansraj College, Delhi',
      'Loyola College, Chennai',
      'St. Xavier\'s College, Kolkata',
      'St. Xavier\'s College, Mumbai',
      'Fergusson College, Pune',
    ],
  },
];

/** Every college, flat, for matching what a student types or pastes. */
const COLLEGES = COLLEGE_GROUPS.flatMap((g) => g.colleges);

/**
 * The name a student wrote, resolved to the institution's own name.
 *
 * People write "kiit bbsr", "IIT-M", "bits pilani". The page should carry the
 * name the institution uses, because that is the string a recruiter and a
 * search filter both match on.
 */
const ALIASES = {
  'kiit': 'Kalinga Institute of Industrial Technology (KIIT)',
  'iit madras': 'Indian Institute of Technology Madras',
  'iit-m': 'Indian Institute of Technology Madras',
  'iitm': 'Indian Institute of Technology Madras',
  'iit bombay': 'Indian Institute of Technology Bombay',
  'iitb': 'Indian Institute of Technology Bombay',
  'iit delhi': 'Indian Institute of Technology Delhi',
  'iitd': 'Indian Institute of Technology Delhi',
  'bits': 'Birla Institute of Technology and Science, Pilani',
  'bits pilani': 'Birla Institute of Technology and Science, Pilani',
  'vit': 'Vellore Institute of Technology',
  'srm': 'SRM Institute of Science and Technology',
  'nit trichy': 'National Institute of Technology Tiruchirappalli',
  'nitk': 'National Institute of Technology Surathkal',
  'dtu': 'Delhi Technological University',
  'nsut': 'Netaji Subhas University of Technology',
  'iiit hyderabad': 'International Institute of Information Technology Hyderabad',
  'iiith': 'International Institute of Information Technology Hyderabad',
  'du': 'University of Delhi',
  'jnu': 'Jawaharlal Nehru University, New Delhi',
  'bhu': 'Banaras Hindu University',
  'amu': 'Aligarh Muslim University',
  'lpu': 'Lovely Professional University',
  'soa': 'Siksha O Anusandhan University',
};

function matchCollege(typed) {
  const t = String(typed || '').trim().toLowerCase();
  if (!t) return '';
  if (ALIASES[t]) return ALIASES[t];
  const exact = COLLEGES.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  /* A distinctive fragment — "kalinga", "jadavpur" — is enough, as long as it
     names exactly one institution. Two matches means we do not know. */
  const hits = COLLEGES.filter((c) => c.toLowerCase().includes(t));
  return hits.length === 1 ? hits[0] : '';
}

module.exports = { COLLEGE_GROUPS, COLLEGES, matchCollege };
