/*
 * Every word on the site lives here. Edit this file to update the page;
 * site.js renders it into the layout. Keep entries short and plain. (Each
 * painting's own words, its title and screen-reader description, live with
 * it in scenes/.)
 *
 * Text fields are plain text. Links are { label, url }.
 */
window.CONTENT = {
  name: 'Christopher Wang',
  tagline: 'CS & Math @ MIT',
  location: 'Cambridge, MA',
  lastUpdated: 'October 2026',

  // assembled in the browser so the address never appears whole in the HTML
  email: { user: 'chriswang8314', domain: 'gmail.com' },
  links: {
    github: 'https://github.com/chriswang8314',
    linkedin: 'https://www.linkedin.com/in/chriswang8314',
    resume: 'resume.pdf',
  },

  currently: [
    'Building an agentic pipeline that pulls protein-interaction data out of scientific papers for phase-separation research (UROP, MIT).',
    'Recording live NFL play-by-play next to Polymarket order books to see how fast prices react.',
    'Taking Probability (18.600), Linear Algebra (18.C06), Programming (6.1010) and C & Assembly (6.1903).',
  ],

  // most impressive and relevant first
  projects: [
    {
      title: 'NFL Prediction-Market Data Platform',
      org: 'Personal project',
      dates: 'Sept 2026 – now',
      description:
        'An async Python platform that records live NFL play-by-play and Polymarket US order books: about 300 markets per game, 15M updates across 13 games. Its payout logic matched all 4,460 settled markets, and it showed that free ESPN data trails market prices by a median 32 s (58 plays, 11 games).',
      tags: ['Python', 'asyncio', 'WebSockets', 'SQLite', 'pytest'],
      links: [],
    },
    {
      title: 'Research Intern',
      org: 'Cleveland Clinic, Imaging Institute',
      dates: 'June 2024 – Aug 2026',
      description:
        'Built a Python pipeline that turns patient handwriting into a measurable tremor signal, then trained a PyTorch classifier to replace the hand-written algorithm. The evaluation pipeline is in active use in ongoing HIFU thrombolysis clinical trials; I also shipped a prototype Android app for real-time motor monitoring.',
      tags: ['Python', 'PyTorch', 'Image processing', 'Android'],
      links: [],
    },
    {
      title: 'Garcia Research Scholar',
      org: 'Stony Brook University',
      dates: 'June – Aug 2025',
      description:
        'Designed a thermal shape-memory polymer for mechanical severance in brain-aneurysm treatment, tuning its composition against NMR/FTIR data to exceed 90% crosslinking efficiency. Co-authored a paper in MRS Communications and presented at MRS Fall 2025.',
      tags: ['Polymer chemistry', 'NMR', 'FTIR', 'Biomaterials'],
      links: [
        {
          label: 'MRS Fall 2025 talk',
          url: 'https://www.mrs.org/meetings-events/annual-meetings/archive/meeting/presentations/view/2025-mrs-fall-meeting/2025-mrs-fall-meeting-4407521',
        },
      ],
    },
    {
      title: 'UROP',
      org: 'MIT, Alexander-Katz group (Laboratory for Soft Materials)',
      dates: 'Sept 2026 – now',
      description:
        'Developing an agentic pipeline that automatically extracts protein-interaction data from scientific literature for phase-separation research.',
      tags: ['Agentic pipelines', 'Literature mining', 'Phase separation'],
      links: [
        { label: 'Prof. Alfredo Alexander-Katz', url: 'https://dmse.mit.edu/people/faculty/alfredo-alexander-katz-2/' },
      ],
    },
    {
      title: 'Arithmetic Speed Drill',
      org: 'Personal project',
      dates: 'Oct 2026',
      description:
        'A Zetamac-style mental-math trainer, built as a dependency-free iOS web app you can install. It works fully offline, has a low-latency keypad, and keeps score history for each settings combination.',
      tags: ['JavaScript', 'HTML/CSS', 'Service Workers'],
      links: [
        { label: 'Live', url: 'https://chriswang8314.github.io/arithmetic-game/' },
        { label: 'GitHub', url: 'https://github.com/chriswang8314/arithmetic-game' },
      ],
    },
    {
      title: 'Project Manager',
      org: 'XCel Future',
      dates: 'Jan – Dec 2024',
      description:
        "Planned and led events at two senior-living facilities serving Cleveland's elderly Asian community, and coordinated medical appointments to improve healthcare access.",
      tags: ['Leadership', 'Community health'],
      links: [],
    },
  ],

  about: [
    "I study computer science and math at MIT, graduating in 2029. Right now I'm working on a UROP that extracts protein-interaction data from papers, and building a platform that records NFL prediction markets.",
    "Before MIT, I spent two years at the Cleveland Clinic's Imaging Institute, where I taught myself deep learning to turn a tremor-measurement algorithm into a trained classifier, and did polymer research at Stony Brook that became a paper in MRS Communications. In 2025 I placed in the top 20 on the US National Chemistry Olympiad exam and went to the selection camp for the International Chemistry Olympiad.",
  ],

  contact: 'Email is the best way to reach me.',
};
