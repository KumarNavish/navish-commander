"""Independent behavioral checks; argument is one isolated module path."""
import copy, importlib.util, json, random, sys
path=sys.argv[1]
spec=importlib.util.spec_from_file_location('candidate',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
checks=[]
def check(name,actual,expected):
    checks.append({'name':name,'passed':actual==expected,'actual':actual,'expected':expected})
def raises(name,call):
    try:call();check(name,'returned','ValueError')
    except ValueError:check(name,'ValueError','ValueError')
    except Exception as e:check(name,type(e).__name__,'ValueError')
if path.endswith('intervals.py'):
    f=module.merge_intervals
    samples=[([],[]),([[5,8],[1,2]],[[1,2],[5,8]]),([[1,9],[2,3]],[[1,9]]),([[1,2],[2,4]],[[1,4]]),([[-3,0],[-1,4],[9,9]], [[-3,4],[9,9]]),([[1,1],[1,1]],[[1,1]]),([[1,4],[2,9],[3,5]],[[1,9]])]
    for i,(v,expected) in enumerate(samples):
        before=copy.deepcopy(v);check('example-'+str(i),f(v),expected);check('immutable-'+str(i),v,before)
    raises('reversed',lambda:f([[4,2]]))
    rng=random.Random(201)
    for i in range(80):
        v=[sorted([rng.randint(-8,8),rng.randint(-8,8)]) for _ in range(rng.randint(0,14))]
        out=f(v)
        coverage=lambda seq:[x for x in range(-16,17) if any(2*a<=x<=2*b for a,b in seq)]
        check('coverage-'+str(i),coverage(out),coverage(v))
        check('disjoint-sorted-'+str(i),all(out[j][1]<out[j+1][0] for j in range(len(out)-1)),True)
elif path.endswith('pages.py'):
    f=module.paginate
    for n in range(9):
      for offset in range(12):
       for limit in [1,2,3,7,20]:
        values=[str(i)+'é' for i in range(n)];before=values[:]
        selected=values[offset:offset+limit]
        expected={'items':selected,'nextOffset':offset+len(selected) if offset+len(selected)<n else None}
        out=f(values,offset,limit)
        check(f'page-{n}-{offset}-{limit}',out,expected)
        check(f'immutable-{n}-{offset}-{limit}',values,before)
        check(f'new-list-{n}-{offset}-{limit}',out['items'] is not values,True)
    for offset,limit in [(-1,1),(0,0),(0,-2),(True,2),(0,False),(0,1.5),('0',2),(None,1)]:raises('invalid-'+repr((offset,limit)),lambda o=offset,l=limit:f([1,2],o,l))
elif path.endswith('graph.py'):
    f=module.order_tasks
    samples=[({},[]),({'a':['z'],'b':[],'z':[]},['b','z','a']),({'a':['b','b']},['b','a']),({'x':['z'],'y':['z']},['z','x','y']),({'build':['test'],'test':['lint'],'lint':[]},['lint','test','build'])]
    for i,(v,expected) in enumerate(samples):
        before=copy.deepcopy(v);check('example-'+str(i),f(v),expected);check('immutable-'+str(i),v,before)
    for v in [{'x':['x']},{'a':['b'],'b':['a']},{'a':[],'b':['c'],'c':['b']}]:raises('cycle-'+repr(v),lambda v=v:f(v))
    rng=random.Random(209)
    for i in range(80):
        order=list('abcdefg');rng.shuffle(order)
        deps={n:[m for m in order[:j] if rng.randrange(3)==0] for j,n in enumerate(order)}
        pending=set(deps);expected=[]
        while pending:
            chosen=min(n for n in pending if set(deps[n])<=set(expected));expected.append(chosen);pending.remove(chosen)
        check('dag-'+str(i),f(deps),expected)
else:raise ValueError('Unknown candidate module')
print(json.dumps({'passed':all(c['passed'] for c in checks),'checks':len(checks),'failures':[c for c in checks if not c['passed']]}))
sys.exit(0 if all(c['passed'] for c in checks) else 1)
