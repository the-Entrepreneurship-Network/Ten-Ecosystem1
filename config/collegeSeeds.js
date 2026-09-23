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

/*
 * Deduplicated on the way out. The list is grouped by region for whoever edits
 * it, and a college that is both an NIT and in its state's section is an easy
 * mistake to make — 26 of them were, the first time this list was extended.
 * A duplicate costs a wasted visit, so the set is the source of truth rather
 * than the literal below.
 */
const RAW_SEEDS = [
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
    'jssaten.ac.in', 'abes.ac.in', 'kiet.edu', 'niet.co.in',

    // ── Tamil Nadu ──────────────────────────────────────────────────────────
    'svce.ac.in', 'sriramec.edu.in', 'velammal.edu.in', 'easwari.ac.in',
    'panimalar.ac.in', 'jeppiaarcollege.org', 'sairam.edu.in', 'saveetha.ac.in',
    'hindustanuniv.ac.in', 'crescent.education', 'vit.ac.in', 'vitchennai.ac.in',
    'karunya.edu', 'psgitech.ac.in', 'kct.ac.in', 'skcet.ac.in',
    'bitsathy.ac.in', 'kpriet.ac.in', 'drngpit.ac.in', 'srec.ac.in',
    'coimbatore.amrita.edu', 'nandhaengg.org', 'ksrct.ac.in', 'mkce.ac.in',
    'act.edu.in', 'aubit.edu.in', 'nec.edu.in', 'ksrcas.edu',
    'sethu.ac.in', 'kamarajengg.edu.in', 'velstech.com', 'annauniv.edu',

    // ── Karnataka ───────────────────────────────────────────────────────────
    'bmsit.ac.in', 'cmrit.ac.in', 'nhce.edu.in', 'nmit.ac.in',
    'sirmvit.edu', 'acharya.ac.in', 'dsatm.edu.in', 'eastpoint.ac.in',
    'jyothyit.ac.in', 'kssem.edu.in', 'sapthagiri.edu.in', 'bit-bangalore.edu.in',
    'sjbit.edu.in', 'sit.ac.in', 'gat.ac.in', 'mvjce.edu.in',
    'jainuniversity.ac.in', 'alliance.edu.in', 'presidencyuniversity.in',
    'cmr.edu.in', 'nitte.edu.in', 'mite.ac.in', 'aiet.org.in',
    'srinivasuniversity.edu.in', 'pace.edu.in', 'bvbcet.ac.in', 'kletech.ac.in',
    'git.edu', 'sdmcet.ac.in', 'basavarajeswari.org',

    // ── Maharashtra ─────────────────────────────────────────────────────────
    'pict.edu', 'viit.ac.in', 'pccoepune.com', 'mitaoe.ac.in',
    'dypvp.edu.in', 'sinhgad.edu', 'aissmscoe.com', 'vupune.ac.in',
    'cummins.ac.in', 'moderncoe.edu.in', 'nbnstic.com', 'jspmrscoe.edu.in',
    'rait.ac.in', 'fcrit.ac.in', 'tsec.edu', 'vit.edu.in',
    'sfit.ac.in', 'xavier.ac.in', 'rizvi.edu.in', 'atharvacoe.ac.in',
    'ternaengg.ac.in', 'pvppcoe.ac.in', 'vesit.ac.in', 'sakec.ac.in',
    'ghrce.raisoni.net', 'ycce.edu', 'kdkce.edu.in', 'stvincentngp.edu.in',
    'sggs.ac.in', 'coeas.ac.in',

    // ── Telangana and Andhra Pradesh ────────────────────────────────────────
    'cbit.ac.in', 'vnrvjiet.ac.in', 'griet.ac.in', 'mgit.ac.in',
    'gokaraju.ac.in', 'cvr.ac.in', 'mvsrec.edu.in', 'vardhaman.org',
    'bvrit.ac.in', 'bvrithyderabad.edu.in', 'anurag.edu.in', 'cmrcet.ac.in',
    'mlrinstitutions.ac.in', 'kmit.in', 'vce.ac.in', 'sreenidhi.edu.in',
    'sreyas.ac.in', 'stanley.edu.in', 'mahindrauniversity.edu.in',
    'rvrjc.ac.in', 'vvitguntur.com', 'bec.edu.in', 'anits.edu.in',
    'gvpce.ac.in', 'aec.edu.in', 'svce.edu.in', 'nriit.edu.in',
    'vrsec.ac.in', 'sves.org.in', 'svuniversity.edu.in',

    // ── Delhi NCR, Punjab, Haryana, Rajasthan ───────────────────────────────
    'msit.in', 'bvicam.in', 'mait.ac.in', 'adgitmdelhi.ac.in',
    'bpitindia.com', 'hmritm.ac.in', 'gtbit.ac.in', 'vips.edu',
    'jimsindia.org', 'nitdelhi.ac.in', 'igdtuw.ac.in', 'iiitd.ac.in',
    'manavrachna.edu.in', 'ncuindia.edu', 'jcboseust.ac.in', 'dcrustm.ac.in',
    'thapar.edu', 'chitkara.edu.in', 'cgc.edu.in', 'gndec.ac.in',
    'bbsbec.ac.in', 'ctgroup.in', 'rimt.ac.in', 'cup.edu.in',
    'mnit.ac.in', 'skit.ac.in', 'poornima.org', 'jecrcuniversity.edu.in',
    'manipal.edu', 'banasthali.org', 'mody.edu', 'bitspilani.ac.in',

    // ── Gujarat, MP, Chhattisgarh ───────────────────────────────────────────
    'ldce.ac.in', 'gcet.ac.in', 'adit.ac.in', 'bvmengineering.ac.in',
    'svit-vasad.ac.in', 'darshan.ac.in', 'marwadieducation.edu.in',
    'rku.ac.in', 'paruluniversity.ac.in', 'silveroakuni.ac.in',
    'gtu.ac.in', 'svnit.ac.in', 'iitgn.ac.in',
    'medicaps.ac.in', 'sgsits.ac.in', 'ietdavv.edu.in', 'oriental.ac.in',
    'lnct.ac.in', 'jec-jabalpur.org', 'manit.ac.in', 'nitrr.ac.in',
    'bitdurg.ac.in', 'ssipmt.com', 'csvtu.ac.in',

    // ── East and North-East ─────────────────────────────────────────────────
    'iemcal.com', 'heritageit.edu', 'techno-india.com', 'jisgroup.org',
    'meghnad.ac.in', 'ghani.ac.in', 'rcciit.org', 'uem.edu.in',
    'kiit.ac.in', 'silicon.ac.in', 'iter.ac.in', 'cvrce.edu.in',
    'trident.ac.in', 'gita.edu.in', 'vssut.ac.in', 'igitsarang.ac.in',
    'bitmesra.ac.in', 'cuj.ac.in', 'nitjsr.ac.in', 'bceranchi.ac.in',
    'nerist.ac.in', 'tezu.ernet.in', 'gauhati.ac.in', 'assamengg.ac.in',
    'jorhatengineeringcollege.org', 'nitmz.ac.in',

    // ── Kerala ──────────────────────────────────────────────────────────────
    'cet.ac.in', 'mec.ac.in', 'rit.ac.in', 'gecbh.ac.in',
    'tkmce.ac.in', 'nssce.ac.in', 'gectcr.ac.in', 'mgits.ac.in',
    'rajagiritech.ac.in', 'fisat.ac.in', 'sjcetpalai.ac.in', 'saintgits.org',
    'amaljyothi.ac.in', 'mbcet.ac.in', 'cusat.ac.in', 'ktu.edu.in'

];

const SEED_COLLEGES = Object.freeze([...new Set(RAW_SEEDS)]);

module.exports = { SEED_COLLEGES, RAW_SEEDS };
