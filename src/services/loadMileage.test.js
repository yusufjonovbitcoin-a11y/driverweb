import test from 'node:test';import assert from 'node:assert/strict';
import {loadMileage} from './loadMileage.js';
const load={id:'load',driver_id:'driver',current_assignment_id:'assignment',loaded_miles:0,driver_brief:{unknownFields:['loadedMiles']}};
const pay={assignment_id:'assignment',load_id:'load',driver_id:'driver',currency:'USD',loaded_miles:'288.23'};
test('a frozen current route supplies missing document miles without including deadhead',()=>{
 assert.deepEqual(loadMileage(load,{...pay,deadhead_miles:'355.94',total_miles:'644.17'}),{distanceMiles:288.23,distanceKnown:true,mileageSource:'assignment_route'});
});
test('another assignment, driver, load or invalid snapshot never supplies miles',()=>{
 assert.equal(loadMileage({...load,current_assignment_id:undefined},undefined).distanceKnown,false);
 for(const patch of [{assignment_id:'old'},{driver_id:'other'},{load_id:'other'},{currency:'EUR'},{loaded_miles:null},{loaded_miles:'NaN'},{loaded_miles:-1}])assert.equal(loadMileage(load,{...pay,...patch}).distanceKnown,false);
});
test('known document mileage remains distinct from calculated road mileage',()=>{
 assert.deepEqual(loadMileage({...load,loaded_miles:'300',driver_brief:{}},pay),{distanceMiles:300,distanceKnown:true,mileageSource:'document'});
});
