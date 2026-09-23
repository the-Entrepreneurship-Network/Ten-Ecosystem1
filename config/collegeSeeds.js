'use strict';

/**
 * Colleges the agent knows to visit on its first run.
 *
 * This is the same honest limit services/v2/atsBoards.js states about its
 * company roster: nobody can enumerate every institution in India, so this
 * ships a starting set and treats it as a starting set. Every domain here is
 * a real, well-known Indian institution — a fabricated one would simply time
 * out and make the agent look broken.
 *
 * TO GO BEYOND IT, the agent is the realistic path — not an import. AICTE
 * publishes its approved-institution lists as PDFs, and the AICTE datasets on
 * data.gov.in are statistics (seat counts, enrolment) rather than a directory
 * carrying email addresses. An earlier version of this comment claimed a
 * downloadable regulator CSV with contact details; that was never verified and
 * appears not to exist.
 *
 * So: extend this list, and press run. scripts/import-colleges.js is still
 * there for any spreadsheet that DOES carry names and addresses — a state
 * board's list, a conference roster, anything already in hand — but there is
 * no known free file that fills it in one go.
 */

const SEED_COLLEGES = Object.freeze([
    // ── IITs ────────────────────────────────────────────────────────────────
    'iitb.ac.in', 'iitd.ac.in', 'iitm.ac.in', 'iitk.ac.in', 'iitkgp.ac.in',
    'iitr.ac.in', 'iitg.ac.in', 'iith.ac.in', 'iitbhu.ac.in', 'iitrpr.ac.in',
    'iitgn.ac.in', 'iitj.ac.in', 'iiti.ac.in', 'iitmandi.ac.in', 'iitp.ac.in',
    'iitbbs.ac.in', 'iitism.ac.in', 'iitpkd.ac.in', 'iittp.ac.in', 'iitbhilai.ac.in',
    'iitgoa.ac.in', 'iitjammu.ac.in', 'iitdh.ac.in',

    // ── NITs ────────────────────────────────────────────────────────────────
    'nitt.edu', 'nitk.ac.in', 'nitw.ac.in', 'nitc.ac.in', 'nitrkl.ac.in',
    'mnit.ac.in', 'nitkkr.ac.in', 'nith.ac.in', 'nitdgp.ac.in', 'nitjsr.ac.in',
    'nitp.ac.in', 'manit.ac.in', 'nitsri.ac.in', 'nitgoa.ac.in', 'nitandhra.ac.in',
    'nitdelhi.ac.in', 'nitpy.ac.in', 'nitm.ac.in', 'nituk.ac.in', 'nitsikkim.ac.in',
    'nitmz.ac.in', 'nitmeghalaya.ac.in', 'nitnagaland.ac.in', 'nitmanipur.ac.in',
    'nitap.ac.in', 'nitjalandhar.ac.in', 'nitsurat.ac.in', 'vnit.ac.in',

    // ── IIITs ───────────────────────────────────────────────────────────────
    'iiit.ac.in', 'iiitd.ac.in', 'iiitb.ac.in', 'iiita.ac.in', 'iiitdm.ac.in',
    'iiitg.ac.in', 'iiitkota.ac.in', 'iiitl.ac.in', 'iiitn.ac.in', 'iiitp.ac.in',
    'iiitvadodara.ac.in', 'iiitdmj.ac.in', 'iiitranchi.ac.in', 'iiitsurat.ac.in',

    // ── Central and state universities ──────────────────────────────────────
    'du.ac.in', 'jnu.ac.in', 'bhu.ac.in', 'amu.ac.in', 'jmi.ac.in',
    'unipune.ac.in', 'mu.ac.in', 'uohyd.ac.in', 'caluniv.ac.in', 'annauniv.edu',
    'osmania.ac.in', 'bangaloreuniversity.ac.in', 'uok.ac.in', 'ku.ac.in',
    'gujaratuniversity.ac.in', 'puchd.ac.in', 'rgpv.ac.in', 'aktu.ac.in',
    'wbut.ac.in', 'ptu.ac.in', 'vtu.ac.in', 'jntuh.ac.in', 'jntuk.edu.in',
    'jntua.ac.in', 'dtu.ac.in', 'nsut.ac.in', 'ipu.ac.in', 'jamiahamdard.edu',

    // ── Deemed and private universities ─────────────────────────────────────
    'bits-pilani.ac.in', 'vit.ac.in', 'srmist.edu.in', 'manipal.edu',
    'amrita.edu', 'thapar.edu', 'lpu.in', 'chitkara.edu.in', 'christuniversity.in',
    'symbiosis.ac.in', 'nmims.edu', 'somaiya.edu', 'djsce.ac.in', 'spit.ac.in',
    'kjsce.somaiya.edu', 'sitpune.edu.in', 'mitwpu.edu.in', 'dypatil.edu',
    'bennett.edu.in', 'shooliniuniversity.com', 'jaypeeuniversity.ac.in',
    'jiit.ac.in', 'galgotiasuniversity.edu.in', 'sharda.ac.in', 'amity.edu',
    'ashoka.edu.in', 'krmangalam.edu.in', 'gnu.ac.in', 'nirmauni.ac.in',
    'pdpu.ac.in', 'daiict.ac.in', 'ddu.ac.in', 'charusat.ac.in',
    'srmap.edu.in', 'klu.ac.in', 'vrsiddhartha.ac.in', 'gitam.edu',
    'reva.edu.in', 'pes.edu', 'rvce.edu.in', 'bmsce.ac.in', 'msrit.edu',
    'dsce.edu.in', 'sit.ac.in', 'nie.ac.in', 'jssstuniv.in',
    'ssn.edu.in', 'psgtech.edu', 'cit.edu.in', 'kongu.edu', 'tce.edu',
    'mepcoeng.ac.in', 'sastra.edu', 'skcet.ac.in', 'rajalakshmi.org',
    'cusat.ac.in', 'rit.ac.in', 'tkmce.ac.in', 'gecbh.ac.in',
    'nitte.edu.in', 'sjec.ac.in', 'canaraengineering.in',
    'coep.ac.in', 'vjti.ac.in', 'walchandsangli.ac.in', 'sggs.ac.in',
    'iiests.ac.in', 'jadavpuruniversity.in', 'heritageit.edu', 'iemcal.com',
    'kiit.ac.in', 'silicon.ac.in', 'cet.edu.in', 'nist.edu',
    'bitmesra.ac.in', 'cuj.ac.in',
    'mnnit.ac.in', 'iiitm.ac.in', 'miet.ac.in', 'akgec.ac.in',
    'jssaten.ac.in', 'abes.ac.in', 'kiet.edu', 'niet.co.in'
]);

module.exports = { SEED_COLLEGES };
