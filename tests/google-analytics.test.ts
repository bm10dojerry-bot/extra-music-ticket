import {strict as assert} from "node:assert";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {analyticsHash,compatibleAnalyticsSite,isAnalyticsAdminOrigin,newAnalyticsAuthorization,openAnalyticsSecret,sealAnalyticsSecret,
 validAnalyticsBinding,validAnalyticsId,validAnalyticsState,validMeasurementId} from "../lib/google-analytics-security";
import {parseAnalyticsRealtime,type AnalyticsRealtimePayload} from "../lib/google-analytics-report";

const secret="synthetic-test-key-with-at-least-24-characters";
const payload=(dimensions:string[],rows:Array<[string[],number]>,rowCount=rows.length):AnalyticsRealtimePayload=>({
 dimensionHeaders:dimensions.map(name=>({name})),metricHeaders:[{name:"activeUsers"}],rowCount,
 rows:rows.map(([values,count])=>({dimensionValues:values.map(value=>({value})),metricValues:[{value:String(count)}]})),
});
const total=payload([],[[[],7]]),countries=payload(["countryId","country"],[[["VN","Vietnam"],6],[["JP","Japan"],2]]);
const cities=payload(["countryId","country","city"],[[["VN","Vietnam","City Alpha"],5],[["VN","Vietnam","City Beta"],4],[["JP","Japan","City Gamma"],2]]);

test("refresh credentials are authenticated ciphertext with independent nonces and purpose separation",()=>{
 const value="synthetic-refresh-token",cipher=sealAnalyticsSecret(value,secret,"refresh-token"),second=sealAnalyticsSecret(value,secret,"refresh-token");
 assert.notEqual(cipher,second);assert.equal(cipher.includes(value),false);
 assert.equal(openAnalyticsSecret(cipher,secret,"refresh-token"),value);
 assert.throws(()=>openAnalyticsSecret(cipher,secret,"pkce-verifier"));
 assert.throws(()=>openAnalyticsSecret(cipher,secret+"wrong","refresh-token"));
 const parts=cipher.split(".");const changed=Buffer.from(parts[2],"base64url");changed[0]^=1;parts[2]=changed.toString("base64url");
 assert.throws(()=>openAnalyticsSecret(parts.join("."),secret,"refresh-token"));
 assert.throws(()=>sealAnalyticsSecret(value,"short","refresh-token"));
});
test("OAuth state, browser binding and PKCE are independent high-entropy values",()=>{
 const first=newAnalyticsAuthorization(),second=newAnalyticsAuthorization();
 assert.equal(validAnalyticsState(first.state),true);assert.equal(validAnalyticsBinding(first.binding),true);
 assert.notEqual(first.state,second.state);assert.notEqual(first.binding,second.binding);assert.notEqual(first.verifier,second.verifier);
 assert.match(first.verifier,/^[A-Za-z0-9_-]{43,128}$/);
 assert.equal(first.challenge,createHash("sha256").update(first.verifier).digest("base64url"));
 assert.notEqual(analyticsHash(first.state),analyticsHash(first.binding));
 assert.equal(validAnalyticsState(first.state+".extra"),false);assert.equal(validAnalyticsBinding(first.binding.slice(1)),false);
});
test("management mutations accept only exact HTTPS Admin same-origin requests",()=>{
 const allowed=new Headers({origin:"https://admin.iextra.net","sec-fetch-site":"same-origin"});
 assert.equal(isAnalyticsAdminOrigin("https://admin.iextra.net/api/admin/google-analytics",allowed),true);
 for(const origin of ["https://iextra.net","https://sale.iextra.net","https://admin.iextra.net.evil.example","null","http://admin.iextra.net",""])
  assert.equal(isAnalyticsAdminOrigin("https://admin.iextra.net/api/admin/google-analytics",new Headers({origin})),false);
 assert.equal(isAnalyticsAdminOrigin("https://preview.example/api/admin/google-analytics",allowed),false);
 assert.equal(isAnalyticsAdminOrigin("https://admin.iextra.net/api/admin/google-analytics",new Headers({origin:"https://admin.iextra.net","sec-fetch-site":"cross-site"})),false);
});
test("selection cannot redirect report authorization to unrelated websites or malformed resources",()=>{
 for(const url of ["https://iextra.net/","https://www.iextra.net/show/sample","http://iextra.net"])assert.equal(compatibleAnalyticsSite(url),true);
 for(const url of ["https://iextra.net.evil.example","https://iextra.net@evil.example","https://user:secret@iextra.net","https://sale.iextra.net","javascript:alert(1)","https://iextra.net:8443/",""])
  assert.equal(compatibleAnalyticsSite(url),false);
 assert.equal(validAnalyticsId("12345"),true);assert.equal(validAnalyticsId("123/../456"),false);assert.equal(validAnalyticsId("0"),false);
 assert.equal(validMeasurementId("G-ABCDEF1234"),true);assert.equal(validMeasurementId("G-ABC<script>"),false);
});
test("total and country unique users stay independent of summed city counts",()=>{
 const result=parseAnalyticsRealtime(total,countries,cities,"2030-01-01T00:00:00Z");
 assert.equal(result.totalActiveUsers,7);assert.equal(result.countries.find(row=>row.countryId==="VN")!.activeUsers,6);
 assert.equal(result.cities.filter(row=>row.countryId==="VN").reduce((sum,row)=>sum+row.activeUsers,0),9);
 assert.equal(result.windowMinutes,30);assert.equal(result.limited,false);
 assert.deepEqual(Object.keys(result).sort(),["cities","countries","limited","totalActiveUsers","updatedAt","windowMinutes"].sort());
});
test("real zero reports require valid headers while malformed success payloads fail",()=>{
 const empty=parseAnalyticsRealtime(payload([],[]),payload(["countryId","country"],[]),payload(["countryId","country","city"],[]),"2030-01-01T00:00:00Z");
 assert.equal(empty.totalActiveUsers,0);assert.deepEqual(empty.countries,[]);assert.deepEqual(empty.cities,[]);
 assert.equal(parseAnalyticsRealtime({metricHeaders:[{name:"activeUsers"}],rows:[]},countries,cities,"").totalActiveUsers,0);
 assert.throws(()=>parseAnalyticsRealtime({},countries,cities,""));
 assert.throws(()=>parseAnalyticsRealtime(total,{rows:[]},cities,""));
 assert.throws(()=>parseAnalyticsRealtime(total,countries,{metricHeaders:[{name:"activeUsers"}],dimensionHeaders:[],rows:[]},""));
 assert.throws(()=>parseAnalyticsRealtime(payload([],[[[],NaN]]),countries,cities,""));
});
test("truncated rows are explicit and unknown geography is retained without fabricating map positions",()=>{
 const partial=payload(["countryId","country","city"],[[["(not set)","(not set)","(not set)"],3]],1001);
 const result=parseAnalyticsRealtime(total,countries,partial,"2030-01-01T00:00:00Z");
 assert.equal(result.limited,true);assert.deepEqual(result.cities,[{countryId:"",country:"(not set)",city:"(not set)",activeUsers:3}]);
 assert.equal("latitude" in result.cities[0],false);assert.equal("longitude" in result.cities[0],false);
});
