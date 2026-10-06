import CSL from 'citeproc';
import fs from 'fs';
const loc = fs.readFileSync('/home/claude/paper/src/csl/locales-en-US.xml','utf8');
const items = { a:{id:'a',type:'article-journal',title:'Deep work and attention',author:[{family:'Newport',given:'Cal'}],issued:{'date-parts':[[2019]]},'container-title':'Journal of Focus',volume:'4',issue:'2',page:'11-30',DOI:'10.1/abc'},
 b:{id:'b',type:'book',title:'The Craft',author:[{family:'Smith',given:'Jo'},{family:'Lee',given:'Ann'}],issued:{'date-parts':[[2020]]},publisher:'Press'} };
for (const f of ['apa','modern-language-association','chicago-notes-bibliography','chicago-author-date','harvard-cite-them-right','ieee']) {
  const xml = fs.readFileSync(`/home/claude/paper/src/csl/${f}.csl`,'utf8');
  const t=Date.now();
  const sys={retrieveLocale:()=>loc,retrieveItem:(id)=>items[id]};
  const e=new CSL.Engine(sys,xml,'en-US');
  const cls = /class="([\w-]+)"/.exec(xml)[1];
  const r=e.rebuildProcessorState([
    {citationID:'c1',citationItems:[{id:'a',locator:'14',label:'page'}],properties:{noteIndex: cls==='note'?1:0}},
    {citationID:'c2',citationItems:[{id:'a','author-only':true}],properties:{noteIndex:0}},
    {citationID:'c3',citationItems:[{id:'a','suppress-author':true,locator:'20-22',label:'page'},{id:'b'}],properties:{noteIndex: cls==='note'?2:0}},
  ]);
  const bib=e.makeBibliography();
  console.log(f,cls,Date.now()-t,'ms'); console.log(JSON.stringify(r)); console.log(bib[1].map(x=>x.replace(/\s+/g,' ')).join('\n'));
}
