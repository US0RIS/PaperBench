// Demo project: a short, plausible historical essay with real, verifiable bibliographic data.
import { uid, newProject, now, todayDate } from './model.js';

const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const em = (s) => t(s, [{ type: 'em' }]);
const P = (...c) => ({ type: 'paragraph', attrs: { id: uid('par') }, content: c.flat().filter(Boolean).map((x) => (typeof x === 'string' ? t(x) : x)) });
const H = (level, text, extra = {}) => ({ type: 'heading', attrs: { id: uid('hd'), level, ...extra }, content: [t(text)] });
const cite = (items, mode = 'parenthetical') => ({ type: 'citation', attrs: { id: uid('cit'), items: items.map((i) => (typeof i === 'string' ? { sourceId: i } : i)), mode } });
const fn = (content) => ({ type: 'footnote', attrs: { id: uid('fn'), content } });
const xref = (target, kind, form = 'full') => ({ type: 'crossref', attrs: { target, kind, form } });

export function sampleProject() {
  const project = newProject('Information as Metaphor in Mid-Century Biology');
  project.settings.author = 'A. Researcher'; project.settings.institution = 'Department of History of Science'; project.settings.course = 'HIST 410'; project.settings.targetWords = 1200;
  project.settings.title = 'Information as Metaphor in Mid-Century Biology';
  const yr = (y, m, d) => ({ 'date-parts': [[y, ...(m ? [m] : []), ...(d ? [d] : [])]] });
  const src = (o) => ({ _tags: [], _collections: [], _fav: false, _role: '', _added: now(), ...o });
  const sources = [
    src({ id: 'src_shannon48', type: 'article-journal', title: 'A mathematical theory of communication', author: [{ family: 'Shannon', given: 'Claude E.' }], issued: yr(1948, 7), 'container-title': 'Bell System Technical Journal', volume: '27', issue: '3', page: '379-423', DOI: '10.1002/j.1538-7305.1948.tb01338.x', _tags: ['information theory', 'primary'], _role: 'primary', _fav: true, _origin: 'manual' }),
    src({ id: 'src_wc53', type: 'article-journal', title: 'Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid', author: [{ family: 'Watson', given: 'J. D.' }, { family: 'Crick', given: 'F. H. C.' }], issued: yr(1953, 4, 25), 'container-title': 'Nature', volume: '171', issue: '4356', page: '737-738', DOI: '10.1038/171737a0', _tags: ['genetics', 'primary'], _role: 'primary', _origin: 'manual' }),
    src({ id: 'src_darwin59', type: 'book', title: 'On the origin of species by means of natural selection, or the preservation of favoured races in the struggle for life', author: [{ family: 'Darwin', given: 'Charles' }], issued: yr(1859), publisher: 'John Murray', 'publisher-place': 'London', _tags: ['primary', 'natural selection'], _role: 'primary', _origin: 'manual', _files: [{ id: 'file_darwin', name: 'Origin of Species, 1st ed. (excerpt).html', type: 'text/html' }], _readable: true }),
    src({ id: 'src_kay00', type: 'book', title: 'Who wrote the book of life? A history of the genetic code', author: [{ family: 'Kay', given: 'Lily E.' }], issued: yr(2000), publisher: 'Stanford University Press', 'publisher-place': 'Stanford, CA', _tags: ['history', 'secondary'], _role: 'secondary', _origin: 'manual' }),
    src({ id: 'src_ms00', type: 'article-journal', title: 'The concept of information in biology', author: [{ family: 'Maynard Smith', given: 'John' }], issued: yr(2000, 4), 'container-title': 'Philosophy of Science', volume: '67', issue: '2', page: '177-194', DOI: '10.1086/392768', _tags: ['philosophy', 'secondary', 'critique'], _role: 'secondary', _origin: 'manual' }),
    src({ id: 'src_shannon56', type: 'article-journal', title: 'The bandwagon', author: [{ family: 'Shannon', given: 'Claude E.' }], issued: yr(1956, 3), 'container-title': 'IRE Transactions on Information Theory', volume: '2', issue: '1', page: '3', DOI: '10.1109/TIT.1956.1056774', _tags: ['information theory', 'primary'], _role: 'primary', _origin: 'manual' }),
    src({ id: 'src_wiki_it', type: 'entry-encyclopedia', title: 'Information theory', 'container-title': 'Wikipedia', publisher: 'Wikimedia Foundation', URL: 'https://en.wikipedia.org/wiki/Information_theory', accessed: todayDate(), _tags: ['background'], _role: 'background', _origin: 'wikipedia', _kind: 'wikipedia' }),
    src({ id: 'src_crick58', type: 'article-journal', title: 'On protein synthesis', author: [{ family: 'Crick', given: 'F. H. C.' }], issued: yr(1958), 'container-title': 'Symposia of the Society for Experimental Biology', volume: '12', _tags: ['genetics', 'primary', 'to verify'], _role: 'primary', _origin: 'manual' }),
  ];
  const darwinHTML = `<article><h1>On the Origin of Species (1859), first edition: excerpt</h1><p class="meta">Public-domain text. Excerpt prepared for this demonstration; check against a full edition before citing.</p><p data-page="489">It is interesting to contemplate an entangled bank, clothed with many plants of many kinds, with birds singing on the bushes, with various insects flitting about, and with worms crawling through the damp earth, and to reflect that these elaborately constructed forms, so different from each other, and dependent on each other in so complex a manner, have all been produced by laws acting around us.</p></article>`;
  const darwinText = ['It is interesting to contemplate an entangled bank, clothed with many plants of many kinds, with birds singing on the bushes, with various insects flitting about, and with worms crawling through the damp earth, and to reflect that these elaborately constructed forms, so different from each other, and dependent on each other in so complex a manner, have all been produced by laws acting around us.'];
  const figSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 170" font-family="Georgia, serif" font-size="14"><rect width="640" height="170" fill="#fff"/><g fill="none" stroke="#262624" stroke-width="1.4"><rect x="12" y="52" width="104" height="48" rx="3"/><rect x="146" y="52" width="104" height="48" rx="3"/><rect x="290" y="52" width="104" height="48" rx="3"/><rect x="424" y="52" width="104" height="48" rx="3"/><rect x="554" y="52" width="74" height="48" rx="3"/><path d="M116 76h30M250 76h40M394 76h30M528 76h26" marker-end="url(#a)"/><path d="M342 20v32" stroke-dasharray="4 3"/></g><defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L7 4 0 8z" fill="#262624"/></marker></defs><g fill="#262624" text-anchor="middle"><text x="64" y="80">Information</text><text x="64" y="95" font-size="12" fill="#5f5e59">source</text><text x="198" y="80">Transmitter</text><text x="342" y="80">Channel</text><text x="476" y="80">Receiver</text><text x="591" y="80">Destination</text><text x="342" y="14" font-size="12" fill="#5f5e59">noise source</text><text x="198" y="125" font-size="12" fill="#5f5e59">message → signal</text><text x="476" y="125" font-size="12" fill="#5f5e59">received signal → message</text></g></svg>`;
  const notes = [
    { id: 'note_wc', kind: 'quotation', text: 'It has not escaped our notice that the specific pairing we have postulated immediately suggests a possible copying mechanism for the genetic material.', attach: { type: 'source', refId: 'src_wc53' }, sourceId: 'src_wc53', page: '737', tags: ['copying', 'key quote'] },
    { id: 'note_sh', kind: 'quotation', text: 'The fundamental problem of communication is that of reproducing at one point either exactly or approximately a message selected at another point.', attach: { type: 'source', refId: 'src_shannon48' }, sourceId: 'src_shannon48', page: '379', tags: ['definition'] },
    { id: 'note_dw', kind: 'quotation', text: 'It is interesting to contemplate an entangled bank, clothed with many plants of many kinds, with birds singing on the bushes, with various insects flitting about, and with worms crawling through the damp earth, and to reflect that these elaborately constructed forms, so different from each other, and dependent on each other in so complex a manner, have all been produced by laws acting around us.', attach: { type: 'passage', refId: 'hl_darwin' }, sourceId: 'src_darwin59', page: '489', highlightId: 'hl_darwin', tags: ['metaphor'] },
    { id: 'note_par', kind: 'paraphrase', text: 'Shannon frames information as selection among possible messages; meaning is explicitly set aside as irrelevant to the engineering problem.', attach: { type: 'source', refId: 'src_shannon48' }, sourceId: 'src_shannon48', page: '379', tags: ['definition'] },
    { id: 'note_idea', kind: 'idea', text: 'The “code” vocabulary may have travelled further than the mathematics did. Test this against how Kay periodises the genetic-code story.', attach: { type: 'none' }, tags: ['argument'] },
    { id: 'note_q', kind: 'question', text: 'Did Crick adopt Shannon’s formalism, or only the vocabulary? Look at the 1958 paper before asserting either.', attach: { type: 'source', refId: 'src_crick58' }, sourceId: 'src_crick58', tags: ['to verify'] },
  ].map((n) => ({ created: now(), updated: now(), ...n }));
  const highlights = [{ id: 'hl_darwin', sourceId: 'src_darwin59', kind: 'web', page: '489', text: notes[2].text, prefix: '', suffix: '', color: 'yellow', comment: 'Ecological interdependence as an image of “laws” at work.', created: now(), noteId: 'note_dw' }];
  const claims = [{ id: 'clm_copy', text: 'copying mechanism', flag: null, created: now() }, { id: 'clm_vocab', text: 'vocabulary of information entered biology before its mathematics did', flag: 'verify', created: now() }, { id: 'clm_cold', text: 'engineers and biologists used the same words for different things', flag: null, created: now() }];
  const evidence = [{ id: 'ev_1', anchorId: 'clm_copy', type: 'note', refId: 'note_wc', created: now() }, { id: 'ev_2', anchorId: 'clm_cold', type: 'source', refId: 'src_ms00', created: now() }];
  const relations = [{ id: 'rel_1', from: 'src_ms00', to: 'src_kay00', type: 'responds' }, { id: 'rel_2', from: 'src_wc53', to: 'src_shannon48', type: 'background' }, { id: 'rel_3', from: 'src_shannon56', to: 'src_shannon48', type: 'responds' }];
  const comments = [{ id: 'cm_1', text: 'Check whether Shannon himself used “code” in this sense, or only “coding”.', author: 'You', created: now(), resolved: false, replies: [], quote: 'code' }];
  const collections = [{ id: 'col_prim', name: 'Primary sources' }, { id: 'col_sec', name: 'Secondary literature' }];
  sources.forEach((s) => { s._collections = [s._role === 'primary' ? 'col_prim' : s._role === 'secondary' ? 'col_sec' : ''].filter(Boolean); });

  const eqId = 'eq_entropy', figId = 'fig_comm', tblId = 'tbl_terms';
  const body = [
    H(1, 'Introduction'),
    P('In 1948 ', cite([{ sourceId: 'src_shannon48', suppressAuthor: true }], 'narrative'), ' recast a practical engineering problem as a mathematical one: how to reproduce at one point a message selected at another. Within a decade biologists were describing genes as ', em('carriers of information'), ' and the genetic material as a ', em('code'), '. This essay asks how much of that vocabulary was borrowed from communication engineering, and how much of the engineering came with it ', cite([{ sourceId: 'src_kay00' }, { sourceId: 'src_ms00' }]), '.'),
    P('The argument is modest. ', { ...t('The vocabulary of information entered biology before its mathematics did', [{ type: 'claim', attrs: { claimId: 'clm_vocab' } }]) }, ', and that gap explains why the same words could carry different weight for engineers and for biologists.'),
    H(1, 'Background'),
    H(2, 'Shannon’s measure of information'),
    P('Shannon’s opening claim is a statement of purpose: “The fundamental problem of communication is that of reproducing at one point either exactly or approximately a message selected at another point” ', cite([{ sourceId: 'src_shannon48', locator: '379', label: 'page' }]), '. Meaning is deliberately excluded; what matters is the selection from a set of possible messages. For a source emitting symbols with probabilities ', { type: 'math_inline', attrs: { latex: 'p_1, \\dots, p_n' } }, ', the average information per symbol is'),
    { type: 'math_block', attrs: { id: eqId, latex: 'H = -\\sum_{i=1}^{n} p_i \\log_2 p_i', numbered: true } },
    P('measured in bits (', xref(eqId, 'equation'), '). ', xref(figId, 'figure'), ' shows the general communication system within which this measure is defined.'),
    { type: 'figure', attrs: { id: figId, assetId: 'ast_fig1', alt: 'Block diagram: information source, transmitter, channel with a noise source, receiver, destination.', width: 85, align: 'center', credit: 'Redrawn after Shannon (1948).', numbered: true }, content: [{ type: 'figcaption', content: [t('A general communication system: source, transmitter, noisy channel, receiver and destination.')] }] },
    H(2, 'The language of heredity'),
    P('The double-helix paper closes with a famously understated sentence: “It has not escaped our notice that the specific pairing we have postulated immediately suggests a possible copying mechanism for the genetic material” ', cite([{ sourceId: 'src_wc53', locator: '737', label: 'page' }]), '. Even there, the key term is ', { ...t('copying mechanism', [{ type: 'claim', attrs: { claimId: 'clm_copy' } }]) }, ', a chemical rather than a communicative image.'),
    P('The older habit of reading nature through a descriptive image is visible a century earlier:'),
    { type: 'blockquote', attrs: { id: uid('bq') }, content: [P({ ...t(notes[2].text, [{ type: 'quote', attrs: { quoteId: 'hl_darwin', sourceId: 'src_darwin59', page: '489', noteId: 'note_dw' } }]) }, ' ', cite([{ sourceId: 'src_darwin59', locator: '489', label: 'page' }]))] },
    H(1, 'Discussion', { id: 'hd_discussion' }),
    P('Historians of the genetic code have stressed how quickly the new terms spread ', cite([{ sourceId: 'src_kay00' }]), '. ', { ...t('Engineers and biologists used the same words for different things', [{ type: 'claim', attrs: { claimId: 'clm_cold' } }]) }, ', which is the central difficulty raised by ', cite([{ sourceId: 'src_ms00' }], 'narrative'), '.', fn([{ type: 'text', text: 'Shannon himself warned that information theory had become something of a bandwagon and that its reach into other fields should be earned rather than assumed ' }, { type: 'citation', attrs: { id: uid('cit'), items: [{ sourceId: 'src_shannon56', locator: '3', label: 'page' }], mode: 'parenthetical' } }, { type: 'text', text: '.' }]), ' ', xref(tblId, 'table'), ' lists the main terms and how their uses diverged.'),
    { type: 'table_block', attrs: { id: tblId }, content: [
      { type: 'table_caption', content: [t('Terms borrowed from communication theory and their uses in biology')] },
      { type: 'table', content: [
        { type: 'table_row', content: ['Term', 'In communication theory', 'In molecular biology'].map((x) => ({ type: 'table_header', content: [P(x)] })) },
        { type: 'table_row', content: ['Message', 'A selection from a set of possible messages', 'Often the nucleotide sequence itself'].map((x) => ({ type: 'table_cell', content: [P(x)] })) },
        { type: 'table_row', content: ['Code', 'A mapping between symbol sets', 'The correspondence between codons and amino acids'].map((x) => ({ type: 'table_cell', content: [P(x)] })) },
        { type: 'table_row', content: ['Noise', 'Random disturbance in the channel', 'Mutation, treated as copying error'].map((x) => ({ type: 'table_cell', content: [P(x)] })) },
      ] },
      { type: 'table_note', content: [em('Note. '), t('Summary by the author; the mappings are interpretive, not definitions from the sources.')] },
    ] },
    H(1, 'Conclusion', { id: 'hd_conclusion' }),
    P('Information language in biology was a working analogy before it was a theory. Treating it as a metaphor with a history, rather than as a discovery, keeps both the engineering and the biology in view.'),
    H(1, 'Counterarguments to draft', { planning: true }),
    { type: 'callout', attrs: { id: uid('co'), kind: 'note' }, content: [P('Draft note: answer the objection that “information” in biology is more than a metaphor. Start from the critique in Maynard Smith.')] },
    { type: 'task_list', attrs: { id: uid('tl') }, content: [{ type: 'task_item', attrs: { checked: true }, content: [P('Re-read Shannon (1956)')] }, { type: 'task_item', attrs: { checked: false }, content: [P('Verify the claim marked “needs verification”')] }, { type: 'task_item', attrs: { checked: false }, content: [P('Find a secondary source on Crick (1958)')] }] },
  ];
  // comment mark on the phrase "the vocabulary of coding" inserted into the intro paragraph
  const intro = body[1];
  const ci = intro.content.findIndex((x) => x.text === 'code'); intro.content[ci] = t('code', [{ type: 'em' }, { type: 'comment', attrs: { commentId: 'cm_1' } }]);
  const doc = {
    type: 'doc', content: [
      { type: 'title', content: [t('Information as Metaphor in Mid-Century Biology')] }, { type: 'subtitle', content: [t('A short historical essay')] }, { type: 'author', content: [t('A. Researcher')] },
      { type: 'abstract', content: [P('This essay traces how the vocabulary of communication engineering entered molecular biology in the decade after 1948. It argues that the language of information and code arrived before any quantitative theory of biological information, and that this ordering explains persistent disagreements about what “information” means in biology.')] },
      ...body,
    ],
  };
  const blobs = [
    { id: 'file_darwin', blob: new Blob([darwinHTML], { type: 'text/html' }), name: 'Origin of Species (excerpt).html' },
    { id: 'ast_fig1', blob: new Blob([figSVG], { type: 'image/svg+xml' }), name: 'communication-system.svg' },
  ];
  const nl = (kind, target, label) => ({ type: 'notelink', attrs: { kind, target, label } });
  const np = (...c) => ({ type: 'paragraph', attrs: { id: uid('nb') }, content: c.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) });
  const notebook = { type: 'doc', content: [
    { type: 'heading', attrs: { id: 'nb_open', level: 1 }, content: [{ type: 'text', text: 'Open questions' }] },
    { type: 'task_list', attrs: { id: uid('nb') }, content: [{ type: 'task_item', attrs: { checked: false }, content: [np('Check Crick 1958 for his own use of “information”. See ', nl('source', 'src_crick58', 'Crick 1958'))] }, { type: 'task_item', attrs: { checked: false }, content: [np('Does the Discussion section overclaim? ', nl('paper', 'hd_discussion', 'Discussion'))] }] },
    { type: 'heading', attrs: { id: 'nb_ideas', level: 1 }, content: [{ type: 'text', text: 'Ideas' }] },
    np('The “copying” image in the 1953 paper is chemical, not communicative. Worth opening the Conclusion with it. ', nl('paper', 'hd_conclusion', 'Conclusion')),
    np('Related to the first question under ', nl('note', 'nb_open', 'Open questions'), '. Try searching this page with Ctrl+F.'),
  ] };
  return { project, doc, notebook, blobs, texts: { src_darwin59: darwinText }, items: { source: sources, note: notes, highlight: highlights, claim: claims, evidence, relation: relations, comment: comments, collection: collections } };
}
