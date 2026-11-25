import assert from 'node:assert/strict';
import test from 'node:test';
import {labReport} from '../worker/roastery-lab.js';
import {adjustedRunoutMonth, quarterlyIncrease} from '../worker/quarterly-demand.js';

const today = '2026-11-26';

function fixture() {
  const groups = [['lh','Liberty Honduras',90],['lb','Liberty Brazil',120],['r','Rhythm China',180],['o','OH Peru',75],['d','Decaf',30]];
  return {
    recipes: {
      decafProfileGroupId:'d',
      runoutProfiles:groups.map(([id,name])=>({id,name,lotIds:[]})),
      rows:[
        {name:'Liberty Blend',signature:'Liberty',components:[{name:'Liberty Honduras',profileGroupId:'lh',percent:50},{name:'Liberty Brazil',profileGroupId:'lb',percent:50}]},
        {name:'Rhythm',signature:'Rhythm',components:[{name:'Rhythm China',profileGroupId:'r',percent:100}]},
        {name:'OH Peru',signature:'OH',components:[{name:'OH Peru',profileGroupId:'o',percent:100}]},
      ],
    },
    loss:{from:'2026-08-01',asOf:'2026-10-31',rows:[
      ...groups.map(([,name,roastedKg])=>({name,greenKg:roastedKg/0.8,roastedKg})),
      {name:'Liberty Blend',roastedKg:210,greenKg:262.5},
    ]},
  };
}

test('monthly roasted demand averages the measured profile outputs and excludes duplicate blend totals',()=>{
  const demand=labReport(fixture(),today).consumption.roastedDemand;
  assert.deepEqual(demand.months,['2026-08','2026-09','2026-10']);
  assert.deepEqual(demand.rows,[{name:'Liberty',monthlyKg:70},{name:'Rhythm',monthlyKg:60},{name:'OH',monthlyKg:25},{name:'Decaf',monthlyKg:10}]);
});

test('unfinished months, unresolved groups and shared profiles cannot inflate the roasted forecast',()=>{
  const data=fixture();
  data.recipes.rows[1].components[0].profileGroupId='lb';
  assert.deepEqual(labReport(data,today).consumption.roastedDemand.rows.map(row=>row.monthlyKg),[null,null,25,10]);
  data.loss.asOf='2026-10-30';
  assert.ok(labReport(data,today).consumption.roastedDemand.rows.every(row=>row.monthlyKg===null));
});

test('quarterly percentages apply once to each month of their own quarter',()=>{
  const growth={'2026-Q4':25,'2027-Q2':10};
  assert.equal(quarterlyIncrease('2026-11',growth),25);
  assert.equal(quarterlyIncrease('2027-01',growth),0);
  assert.equal(quarterlyIncrease('2027-04',growth),10);
  assert.equal(quarterlyIncrease('2027-07',{'2027-Q3':Infinity}),0);
});

test('runout applies seasonal changes to the same partial inventory month and keeps baseline by default',()=>{
  const pool={asOf:'2026-11-15',depletionMonth:'2027-03',totalKg:450,avgMonthlyKg:100};
  assert.equal(adjustedRunoutMonth(pool,'2026-11',{}),'2027-03');
  assert.equal(adjustedRunoutMonth(pool,'2026-11',{'2026-Q4':100}),'2027-02');
  assert.equal(adjustedRunoutMonth(pool,'2026-11',{'2026-Q4':100,'2027-Q1':100}),'2027-01');
  assert.equal(adjustedRunoutMonth(pool,'2026-11',{'2027-Q2':100}),'2027-03');
  assert.equal(adjustedRunoutMonth(pool,'2027-01',{'2026-Q4':100}),'2027-03');
  assert.equal(adjustedRunoutMonth({...pool,depletionMonth:null},'2026-11',{'2026-Q4':100}),null);
});

test('runout keeps exact boundaries and only treats the remainder of the current month as available',()=>{
  const pool={asOf:'2026-11-15',depletionMonth:'2026-12',totalKg:100,avgMonthlyKg:100};
  assert.equal(adjustedRunoutMonth(pool,'2026-11',{'2026-Q4':100}),'2026-11');
  assert.equal(adjustedRunoutMonth({...pool,projectionInputs:{quantityKg:100.001,monthlyKg:100}},'2026-11',{'2026-Q4':100}),'2026-12');
});
