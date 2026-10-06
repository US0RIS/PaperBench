from lib import *
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    pg.evaluate("""()=>{window.__steps=[];const E=window.__E;const old=E.view.props.dispatchTransaction;E.view.setProps({dispatchTransaction(tr){window.__steps.push(tr.steps.map(s=>s.constructor.name+':'+(s.from??'')+'-'+(s.to??'')+' slice '+(s.slice?JSON.stringify([s.slice.openStart,s.slice.openEnd,s.slice.size]):'')));old.call(this,tr)}})}""")
    pg.keyboard.press('Control+Shift+e')
    pg.evaluate("(()=>{const E=window.__E;let a=null,b=null;E.view.state.doc.descendants((n,p)=>{if(n.isTextblock&&n.textContent.startsWith('In 1948 Shannon'))a=p+10;if(n.isTextblock&&n.textContent.startsWith('The argument is modest'))b=p+12;});const S=E.view.state.selection.constructor;E.view.dispatch(E.view.state.tr.setSelection(S.create(E.view.state.doc,a,b)));E.view.focus()})()")
    pg.evaluate("window.__steps.length=0"); pg.keyboard.press('Delete'); print(pg.evaluate("window.__steps"))
    b.close()
