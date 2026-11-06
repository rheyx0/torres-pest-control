#!/usr/bin/env python3
"""Draws the Technical Manual's ERD (Figure 2 and 2a-2d) from the schema.

    python3 docs/erd/draw_erd.py            # all five figures
    python3 docs/erd/draw_erd.py a b        # only some (all, a, b, c, d)

Needs Pillow and the DejaVu Sans font. The schema comes from two files
dumped from a database built with `npm run db:local`:

    psql -At -F'|' -d torres_pest_control -c "<COLUMNS_SQL>" > docs/erd/schema-columns.txt
    psql -At -F'|' -d torres_pest_control -c "<KEYS_SQL>"    > docs/erd/schema-keys.txt

(the two queries are below). Tables are placed by hand in each figure's
column list; the lines are routed automatically: every line leaves its FK
row and enters the parent's PK row, runs only in the lanes between tables,
and never lies on top of another line (lines to the same parent share one
trunk). The script stops with an error if a line cannot be routed that way.
"""
COLUMNS_SQL = """select c.relname, a.attname, a.attnum, not a.attnotnull from pg_attribute a
  join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r'
  and a.attnum>0 and not a.attisdropped order by 1,3"""
KEYS_SQL = """select conrelid::regclass::text, contype,
  (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid=conrelid and attnum = any(conkey)),
  confrelid::regclass::text, (select string_agg(attname, ',') from pg_attribute where attrelid=confrelid and attnum = any(confkey)),
  conname, coalesce((select bool_and(not attnotnull) from pg_attribute where attrelid=conrelid and attnum=any(conkey)),false),
  (select count(*)>0 from pg_constraint u where u.conrelid=c.conrelid and u.contype in ('u','p') and u.conkey = c.conkey)
  from pg_constraint c where connamespace='public'::regnamespace and contype in ('p','f') order by 1"""
import collections, os, sys, math
from PIL import Image, ImageDraw, ImageFont
D=os.path.dirname(os.path.abspath(__file__))
S=2  # render scale
cols=collections.OrderedDict()
for l in open(f'{D}/schema-columns.txt'):
    t,c,n,nl=l.rstrip('\n').split('|'); cols.setdefault(t,[]).append(c)
pk={}; FKS=[]
for l in open(f'{D}/schema-keys.txt'):
    t,typ,c,rt,rc,name,nl,uq=l.rstrip('\n').split('|')
    if typ=='p': pk[t]=c.split(',')
    else: FKS.append(dict(t=t,c=c,rt=rt,uniq=uq=='t',soft=False))
assert len(FKS)==52 and len(cols)==31
SOFT=[('sessions','user_id','admins'),('sessions','user_id','staff'),('sessions','user_id','technicians'),
      ('notifications','recipient_id','admins'),('notifications','recipient_id','staff'),('notifications','recipient_id','technicians'),
      ('technician_absences','technician_id','technicians'),('appointment_technicians','technician_id','technicians'),
      ('appointments','technician_id','technicians')]
ALL=FKS+[dict(t=a,c=c,rt=b,uniq=False,soft=True) for a,c,b in SOFT]
GROUP={}
for t in ['admins','staff','technicians','sessions','notifications','system_logs','shared_login_accounts','technician_absences']: GROUP[t]='acc'
for t in ['clients','client_documents']: GROUP[t]='cli'
for t in ['appointments','appointment_technicians','appointment_reports','appointment_report_attachments','appointment_status_history','appointment_extras','appointment_services','appointment_plans']: GROUP[t]='sch'
for t in ['quotes','quote_lines','contracts','invoices','invoice_lines','payments']: GROUP[t]='bil'
for t in ['services','service_materials','app_settings','treatment_methods']: GROUP[t]='cat'
for t in ['inventory','inventory_batches','inventory_movements']: GROUP[t]='inv'
COL={'acc':('#C9D1DB','#EEF1F5'),'cli':('#BCD6E8','#E5F1FA'),'sch':('#BFDCC8','#E6F4EA'),
     'bil':('#E8D49C','#FBF3DC'),'cat':('#D4C3E3','#F2EAF8'),'inv':('#EBC3B8','#FBE7E1')}
PAL={'appointments':'#1F6F3F','clients':'#1D5C8C','quotes':'#9A6A00','invoices':'#B4461B','contracts':'#6B4E16',
     'services':'#6C3D99','inventory':'#A3243B','inventory_batches':'#C2185B','inventory_movements':'#7A3B2E',
     'appointment_plans':'#2E7D74','client_documents':'#3F51B5','appointment_extras':'#556B2F',
     'technicians':'#5A6474','staff':'#5A6474','admins':'#5A6474'}
F=lambda sz,b=False: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf'%('-Bold' if b else ''), int(sz*S))
RH=17; HH=24; KW=30; PADR=10
fnt=F(11); fntb=F(11,True); fntk=F(9,True); fnth=F(12,True)

class Tab:
    def __init__(s,name,rows,x,y,stub=False):
        s.name=name; s.rows=rows; s.x=x; s.y=y; s.stub=stub
        tw=max([fnth.getlength(name)/S+24]+[fnt.getlength(r)/S+KW+PADR+8 for r in rows])
        s.w=math.ceil(tw); s.h=HH+RH*len(rows)
    def ry(s,c): return s.y+HH+RH*s.rows.index(c)+RH/2
    @property
    def r(s): return s.x+s.w
    @property
    def b(s): return s.y+s.h

def build(fig, title, layout, core, gut, out, edges_filter=None, notes=None, top=100, legend=True, legcols=None):
    """layout: list of columns; each column = list of table names (stacked). gut: gutter widths list (len = ncols+1)."""
    core=set(core)
    shown=[t for c in layout for t in c]
    E=[e for e in ALL if e['t'] in shown and e['rt'] in shown and (e['t'] in core or e['rt'] in core)]
    if edges_filter: E=[e for e in E if edges_filter(e)]
    # rows per table
    need=collections.defaultdict(set)
    for e in E:
        need[e['t']].add(e['c'])
    def rows_of(t):
        if t in core: return cols[t]
        r=[c for c in cols[t] if c in pk[t] or c in need[t]]
        return r
    # place
    tabs={}; x=gut[0]; colx=[]; GAP=34
    for i,c in enumerate(layout):
        y=top; ws=[]
        tmp=[Tab(t,rows_of(t),0,0,stub=t not in core) for t in c]
        w=max(tb.w for tb in tmp)
        for tb in tmp:
            tb.x=x; tb.w=w; tb.y=y; y+=tb.h+GAP; tabs[tb.name]=tb
        colx.append((x,x+w)); x+=w+gut[i+1]
    W=x; H=max(tb.b for tb in tabs.values())+60
    ncol=len(layout)
    LW,LH=520,150; leg=None
    if legend:
        span=0; k=0
        cs=legcols if legcols else None
        if cs is None:
            cs=[]
            for i in range(ncol):
                cs.append(i)
                if colx[i][1]-colx[0][0]>=LW: break
        lx=colx[cs[0]][0]; ly=max(tabs[layout[i][-1]].b for i in cs)+40
        leg=(lx,ly,lx+LW,ly+LH); H=max(H,ly+LH+40)
    colof={t:i for i,c in enumerate(layout) for t in c}
    # gutters: gutter g is between column g-1 and g; x range
    def gx(g):
        lo=0 if g==0 else colx[g-1][1]; hi=W if g==ncol else colx[g][0]
        return lo,hi
    segs=[]  # (x1,y1,x2,y2,group)
    bends=[]
    trunks={}  # (parent,side) -> x
    rects=[(tb.x,tb.y,tb.r,tb.b) for tb in tabs.values()]+([leg] if leg else [])
    def hits_rect(a,b2,c,d):
        x1,x2=sorted((a,c)); y1,y2=sorted((b2,d))
        for (rx,ry,rr,rb) in rects:
            if x1<rr-0.5 and x2>rx+0.5 and y1<rb+3 and y2>ry-3: return True
        return False
    def seggroups(n,groups,eid):
        src=[g for g in groups if g[0]=='src']; bus=[g for g in groups if g[0]=='bus']
        out=[]
        for i in range(n):
            if i>=n-2 and n>=2: out.append(set(bus))
            elif i==0: out.append(set(src))
            else: out.append({('e',eid)})
        if n==1: out=[set(src)|set(bus)]
        return out
    def collides(path,groups,eid=None):
        sg=list(zip(path,path[1:])); G=seggroups(len(sg),groups,eid)
        for i,(p,q) in enumerate(sg):
            gi=G[i]
            for (a,b2,c,d,g) in segs:
                if g & gi: continue
                if p[1]==q[1] and b2==d and abs(p[1]-b2)<6:
                    if min(p[0],q[0])<max(a,c)+4 and max(p[0],q[0])>min(a,c)-4: return True
                if p[0]==q[0] and a==c and abs(p[0]-a)<6:
                    if min(p[1],q[1])<max(b2,d)+4 and max(p[1],q[1])>min(b2,d)-4: return True
            for (bx,by,g) in bends:
                if g & gi: continue
                if p[1]==q[1] and abs(by-p[1])<4 and min(p[0],q[0])-4<bx<max(p[0],q[0])+4: return True
                if p[0]==q[0] and abs(bx-p[0])<4 and min(p[1],q[1])-4<by<max(p[1],q[1])+4: return True
        for k,v in enumerate(path[1:-1]):
            gv=G[k]|G[k+1]
            for (a,b2,c,d,g) in segs:
                if g & gv: continue
                if b2==d and abs(v[1]-b2)<4 and min(a,c)-4<v[0]<max(a,c)+4: return True
                if a==c and abs(v[0]-a)<4 and min(b2,d)-4<v[1]<max(b2,d)+4: return True
        return False
    def tracks(g):
        lo,hi=gx(g); m=24
        xs=[lo+m+k*12 for k in range(int((hi-lo-2*m)//12)+1)]
        mid=(lo+hi)/2; return sorted(xs,key=lambda v:abs(v-mid))
    def hfree(c1,c2):
        """y channels free across columns c1..c2 inclusive"""
        ys=[]
        for y in range(top-46, int(H)-10, 12):
            ok=True
            for c in range(c1,c2+1):
                for t in layout[c]:
                    tb=tabs[t]
                    if tb.y-8<y<tb.b+8: ok=False;break
                if leg and leg[0]-8<colx[c][1] and leg[2]+8>colx[c][0] and leg[1]-8<y<leg[3]+8: ok=False
                if not ok: break
            if ok: ys.append(y)
        return ys
    routes=[]
    def order(e):
        return -abs(colof[e['t']]-colof[e['rt']])
    for e in sorted(E,key=order):
        A=tabs[e['t']]; B=tabs[e['rt']]; ca,cb=colof[e['t']],colof[e['rt']]
        y1=A.ry(e['c']); yp=B.ry(pk[e['rt']][0] if e['rt']!='app_settings' else 'key')
        best=None
        for sa in ('R','L'):
            for sb in ('L','R'):
                gs=ca+1 if sa=='R' else ca; gt=cb+1 if sb=='R' else cb
                if gs<0 or gt<0: continue
                ax=A.r if sa=='R' else A.x; bx=B.r if sb=='R' else B.x
                key=(e['rt'],sb)
                tcand=[trunks[key]] if key in trunks else tracks(gt)
                grp={('bus',)+key, ('src',e['t'],e['c'],sa)}
                for tx in tcand[:14]:
                    if gs==gt:
                        if e['t']==e['rt'] and sa==sb:
                            path=[(ax,y1),(tx,y1),(tx,yp),(bx,yp)]
                        else:
                            path=[(ax,y1),(tx,y1),(tx,yp),(bx,yp)]
                        cand=[path]
                    else:
                        cand=[]
                        c1,c2=sorted((gs,gt)); ys=hfree(c1,c2-1) if c2-1>=c1 else []
                        ys=sorted(ys,key=lambda y:abs(y-y1)+abs(y-yp))[:12]
                        for sx in tracks(gs)[:14]:
                            for yh in ys:
                                cand.append([(ax,y1),(sx,y1),(sx,yh),(tx,yh),(tx,yp),(bx,yp)])
                    for path in cand:
                        # drop zero-length
                        P=[path[0]]
                        for p in path[1:]:
                            if p!=P[-1]: P.append(p)
                        Q=[P[0]]
                        for i in range(1,len(P)-1):
                            a,b,c=Q[-1],P[i],P[i+1]
                            if (a[0]==b[0]==c[0]) or (a[1]==b[1]==c[1]): continue
                            Q.append(b)
                        Q.append(P[-1]); P=Q
                        bad=False
                        for p,q in zip(P,P[1:]):
                            # stubs touching own tables: shrink ends
                            a,b2=p; c,d=q
                            if p==P[0]: a=a+(1 if sa=='R' else -1)*1
                            if q==P[-1]: c=c+(1 if sb=='R' else -1)*1
                            if hits_rect(a,b2,c,d): bad=True;break
                        if bad: continue
                        if collides(P,grp,id(e)): continue
                        L=sum(abs(p[0]-q[0])+abs(p[1]-q[1]) for p,q in zip(P,P[1:]))+40*len(P)
                        if best is None or L<best[0]: best=(L,P,grp,key)
                        break
                    if best and key in trunks: pass
        if best is None:
            print('NO ROUTE', e['t'],e['c'],'->',e['rt']); continue
        L,P,grp,key=best
        trunks.setdefault(key,P[-2][0])
        G=seggroups(len(P)-1,grp,id(e))
        for i,(p,q) in enumerate(zip(P,P[1:])): segs.append((p[0],p[1],q[0],q[1],G[i]))
        for k,v in enumerate(P[1:-1]): bends.append((v[0],v[1],G[k]|G[k+1]))
        routes.append((e,P))
    # self-check: every line starts on its FK row at the child's edge and ends on the parent's PK row
    for e,P in routes:
        A=tabs[e['t']]; B=tabs[e['rt']]
        assert P[0][1]==A.ry(e['c']) and P[0][0] in (A.x,A.r), e
        assert P[-1][1]==B.ry(pk[e['rt']][0]) and P[-1][0] in (B.x,B.r), e
        for p,q in zip(P,P[1:]): assert p[0]==q[0] or p[1]==q[1]
    assert len(routes)==len(E), 'unrouted'
    # draw
    img=Image.new('RGB',(int(W*S),int(H*S)),'white'); dr=ImageDraw.Draw(img)
    def X(v): return v*S
    tw=fnth.getlength(title); dr.text(((W*S-tw)/2,18*S),title,font=F(16,True),fill='black',anchor='la') if False else None
    ft=F(16,True); dr.text(((W*S-ft.getlength(title))/2,16*S),title,font=ft,fill='black')
    for e,P in routes:
        colr='#8A94A3' if e['soft'] else PAL.get(e['rt'],'#4B5563')
        for p,q in zip(P,P[1:]):
            if e['soft']:
                if p[1]==q[1]:
                    a,b=sorted((p[0],q[0])); k=math.floor(a/14)*14
                    while k<b:
                        u,v=max(k,a),min(k+7,b)
                        if v>u: dr.line([X(u),X(p[1]),X(v),X(p[1])],fill=colr,width=int(1.6*S))
                        k+=14
                else:
                    a,b=sorted((p[1],q[1])); k=math.floor(a/14)*14
                    while k<b:
                        u,v=max(k,a),min(k+7,b)
                        if v>u: dr.line([X(p[0]),X(u),X(p[0]),X(v)],fill=colr,width=int(1.6*S))
                        k+=14
            else:
                dr.line([X(p[0]),X(p[1]),X(q[0]),X(q[1])],fill=colr,width=int(1.6*S))
        for p,q in zip(P,P[1:]):
            pass
    for tb in tabs.values():
        h,b=COL[GROUP[tb.name]]
        dr.rectangle([X(tb.x),X(tb.y),X(tb.r),X(tb.b)],fill=b,outline='#6B7280',width=S)
        dr.rectangle([X(tb.x),X(tb.y),X(tb.r),X(tb.y+HH)],fill=h,outline='#6B7280',width=S)
        dr.text((X(tb.x+tb.w/2),X(tb.y+HH/2)),tb.name,font=fnth,fill='black',anchor='mm')
        dr.line([X(tb.x+KW),X(tb.y+HH),X(tb.x+KW),X(tb.b)],fill='#9CA3AF',width=1)
        softc={(a,c) for a,c,b2 in SOFT}
        for c in tb.rows:
            y=tb.ry(c); tags=[]
            if c in pk[tb.name]: tags.append('PK')
            if any(f['t']==tb.name and f['c']==c for f in FKS): tags.append('FK')
            dr.text((X(tb.x+4),X(y)),' '.join(tags),font=fntk,fill='black',anchor='lm')
            dr.text((X(tb.x+KW+6),X(y)),c,font=fntb if c in pk[tb.name] else fnt,fill='black',anchor='lm')
        if tb.stub:
            pass
    # markers
    for e,P in routes:
        colr='#8A94A3' if e['soft'] else PAL.get(e['rt'],'#4B5563')
        (x0,y0),(x1,_)=P[0],P[1]; d=1 if x1>x0 else -1
        if e['uniq']:
            for k in (8,12): dr.line([X(x0+d*k),X(y0-6),X(x0+d*k),X(y0+6)],fill=colr,width=int(1.6*S))
        else:
            tip=x0+d*13
            for dy in (-6,0,6): dr.line([X(tip),X(y0),X(x0),X(y0+dy)],fill=colr,width=int(1.6*S))
        (xa,ya),(xb,yb)=P[-1],P[-2]; d=1 if xb>xa else -1
        for k in (8,):
            dr.line([X(xa+d*k),X(ya-6),X(xa+d*k),X(ya+6)],fill=colr,width=int(1.6*S))
        if not e['soft'] or True:
            dr.line([X(xa+d*12),X(ya-6),X(xa+d*12),X(ya+6)],fill=colr,width=int(1.6*S))
    # junction dots: where a line joins a trunk that carries on past it
    bus=collections.defaultdict(list)
    for e,P in routes:
        if len(P)>=4: bus[(e['rt'],P[-1][0])].append((e,P))
    for key,lst in bus.items():
        ys=[P[-1][1]]+[P[-3][1] for e,P in lst]
        lo,hi=min(ys),max(ys)
        for e,P in lst:
            v=P[-3]
            if lo<v[1]<hi or (len(lst)>1 and v[1]==P[-1][1]):
                c='#8A94A3' if e['soft'] else PAL.get(e['rt'],'#888')
                dr.ellipse([X(v[0])-3*S,X(v[1])-3*S,X(v[0])+3*S,X(v[1])+3*S],fill=c)
    # source forks (one FK row, several targets)
    src=collections.Counter((e['t'],e['c']) for e,P in routes)
    if leg:
        x0,y0,x1,y1=leg
        dr.rectangle([X(x0),X(y0),X(x1),X(y1)],fill='#FFFFFF',outline='#6B7280',width=S)
        dr.text((X(x0+12),X(y0+16)),'How to read the lines',font=fnth,fill='black',anchor='lm')
        gc='#374151'
        def ln(y,dash=False,one2one=False,c=gc):
            a,b=x0+14,x0+110
            if dash:
                for k in range(a,b,10): dr.line([X(k),X(y),X(min(k+5,b)),X(y)],fill=c,width=int(1.6*S))
            else: dr.line([X(a),X(y),X(b),X(y)],fill=c,width=int(1.6*S))
            if one2one:
                for k in (8,12): dr.line([X(a+k),X(y-6),X(a+k),X(y+6)],fill=c,width=int(1.6*S))
            else:
                for dy in (-6,0,6): dr.line([X(a+13),X(y),X(a),X(y+dy)],fill=c,width=int(1.6*S))
            for k in (8,12): dr.line([X(b-k),X(y-6),X(b-k),X(y+6)],fill=c,width=int(1.6*S))
        rows=[(False,False,'many-to-one: crow\'s foot on the table holding the FK'),
              (False,True,'one-to-one: bars at both ends'),
              (True,False,'account id with no foreign key (admins, staff or technicians)')]
        for i,(dsh,o,t) in enumerate(rows):
            yy=y0+44+i*24; ln(yy,dsh,o); dr.text((X(x0+122),X(yy)),t,font=fnt,fill='black',anchor='lm')
        yy=y0+44+3*24
        dr.ellipse([X(x0+60)-3*S,X(yy)-3*S,X(x0+60)+3*S,X(yy)+3*S],fill=gc); dr.line([X(x0+14),X(yy),X(x0+110),X(yy)],fill=gc,width=int(1.6*S)); dr.line([X(x0+60),X(yy),X(x0+60),X(yy-10)],fill=gc,width=int(1.6*S))
        dr.text((X(x0+122),X(yy)),'lines to the same table join; colour = that table',font=fnt,fill='black',anchor='lm')
    if notes: notes(dr,W,H,X)
    img.convert('RGB').save(out,quality=90,optimize=True)
    print(os.path.basename(out), img.size, 'lines', len(routes))
    return routes

import sys
which=sys.argv[1:] or ['all','a','b','c','d']
A=['clients','client_documents','appointments','appointment_technicians','appointment_reports','appointment_report_attachments','appointment_status_history','appointment_extras','appointment_services','appointment_plans']
B=['quotes','quote_lines','contracts','invoices','invoice_lines','payments']
C=['services','service_materials','app_settings','treatment_methods','inventory','inventory_batches','inventory_movements']
Dd=['admins','staff','technicians','sessions','notifications','system_logs','shared_login_accounts','technician_absences']
assert sorted(A+B+C+Dd)==sorted(cols)
child=lambda core:(lambda e:e['t'] in core)
R={}
if 'all' in which:
    R['all']=build('all','Figure 2. Entity Relationship Diagram (all 31 tables, all columns and relationships)',[
 ['admins','staff','technicians','sessions','shared_login_accounts','system_logs'],
 ['notifications','technician_absences','appointment_technicians','appointment_reports','appointment_report_attachments','appointment_status_history','appointment_services'],
 ['appointments','appointment_extras','appointment_plans','app_settings','treatment_methods'],
 ['clients','client_documents','quotes','quote_lines'],
 ['contracts','invoices','payments'],
 ['invoice_lines','services','service_materials','inventory_movements'],
 ['inventory','inventory_batches']],set(cols),[80,150,170,190,190,190,170,110],f'{D}/erd-figure-2-complete.jpg')
if 'a' in which:
    R['a']=build('a','Figure 2a. Clients, Scheduling and Service Reports',[
 ['appointment_reports','appointment_report_attachments','appointment_status_history','appointment_services','appointment_technicians'],
 ['appointments','appointment_extras'],
 ['appointment_plans','clients','client_documents'],
 ['quotes','contracts','invoices','services','inventory','technicians']],A,[70,150,170,150,70],f'{D}/erd-figure-2a-clients-scheduling.jpg',edges_filter=child(A))
if 'b' in which:
    R['b']=build('b','Figure 2b. Billing: Quotations, Contracts, Invoices and Payments',[
 ['clients','client_documents','appointment_plans'],
 ['quotes','quote_lines'],
 ['contracts','payments'],
 ['invoices','invoice_lines'],
 ['appointments','appointment_extras','services','inventory']],B,[70,160,170,170,150,70],f'{D}/erd-figure-2b-billing.jpg',edges_filter=child(B))
if 'c' in which:
    R['c']=build('c','Figure 2c. Service Catalog and Inventory',[
 ['services','service_materials','app_settings','treatment_methods'],
 ['inventory','inventory_batches'],
 ['inventory_movements','appointments']],C,[70,150,170,70],f'{D}/erd-figure-2c-catalog-inventory.jpg',edges_filter=child(C))
if 'd' in which:
    R['d']=build('d','Figure 2d. Accounts and Security',[
 ['admins','staff','technicians'],
 ['sessions','notifications','technician_absences','shared_login_accounts','system_logs'],
 ['appointments']],Dd,[90,260,150,70],f'{D}/erd-figure-2d-accounts.jpg',edges_filter=child(Dd))
if set(which)>={'a','b','c','d'}:
    n=sum(1 for k in 'abcd' for e,P in R[k] if not e['soft'])
    print('FK lines across 2a-2d:',n)
