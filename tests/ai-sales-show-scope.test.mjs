import test from "node:test";
import assert from "node:assert/strict";
import {resolveSalesShowScope,scopeVerifiedShows,salesTurnInstruction} from "../src/lib/ai-sales-show-scope.mjs";
const shows=[
  {
    "id": "dinh-dung-2811",
    "artist": "Đình Dũng"
  },
  {
    "id": "minh-vuong-0512",
    "artist": "Minh Vương & Duy Khoa"
  },
  {
    "id": "other",
    "artist": "Trịnh Đình Quang"
  }
];
const cases=[
  {
    "name": "Explicit artist overrides previous context",
    "input": {
      "message": "Vé Đình Dũng bao nhiêu em?",
      "previousShowId": "minh-vuong-0512"
    },
    "expected": [
      "single",
      "dinh-dung-2811"
    ]
  },
  {
    "name": "Unaccented artist",
    "input": {
      "message": "gia ve dinh dung"
    },
    "expected": [
      "single",
      "dinh-dung-2811"
    ]
  },
  {
    "name": "One of the artists sharing a show",
    "input": {
      "message": "Duy Khoa có diễn không?"
    },
    "expected": [
      "single",
      "minh-vuong-0512"
    ]
  },
  {
    "name": "Both artists in the same show",
    "input": {
      "message": "Minh Vương và Duy Khoa"
    },
    "expected": [
      "single",
      "minh-vuong-0512"
    ]
  },
  {
    "name": "Do not confuse similarly named artists",
    "input": {
      "message": "Trịnh Đình Quang giá bao nhiêu?"
    },
    "expected": [
      "single",
      "other"
    ]
  },
  {
    "name": "Follow-up stays on selected show",
    "input": {
      "message": "Có ghế nào đẹp không?",
      "previousShowId": "dinh-dung-2811"
    },
    "expected": [
      "single",
      "dinh-dung-2811"
    ]
  },
  {
    "name": "First ad message uses verified referral",
    "input": {
      "message": "Cho mình hỏi giá",
      "referredShowId": "minh-vuong-0512"
    },
    "expected": [
      "single",
      "minh-vuong-0512"
    ]
  },
  {
    "name": "No context",
    "input": {
      "message": "Giá vé bao nhiêu?"
    },
    "expected": [
      "clarify"
    ]
  },
  {
    "name": "Stale context cannot select unavailable show",
    "input": {
      "message": "Giá vé?",
      "previousShowId": "expired"
    },
    "expected": [
      "clarify"
    ]
  },
  {
    "name": "Ambiguous two shows",
    "input": {
      "message": "Đình Dũng hay Minh Vương"
    },
    "expected": [
      "clarify"
    ]
  },
  {
    "name": "Explicit comparison only",
    "input": {
      "message": "So sánh Đình Dũng và Minh Vương"
    },
    "expected": [
      "comparison",
      "dinh-dung-2811",
      "minh-vuong-0512"
    ]
  },
  {
    "name": "Explicit catalog request",
    "input": {
      "message": "Sắp tới có show nào?"
    },
    "expected": [
      "catalog",
      "dinh-dung-2811",
      "minh-vuong-0512",
      "other"
    ]
  },
  {
    "name": "Switch without identifying another show",
    "input": {
      "message": "Em tư vấn show khác đi",
      "previousShowId": "dinh-dung-2811"
    },
    "expected": [
      "clarify"
    ]
  }
];
for(const c of cases) test(c.name,()=>{const v=resolveSalesShowScope({...c.input,shows});assert.deepEqual([v.kind,...v.showIds],c.expected);});
test("Filter trusted show data",()=>{const scope=resolveSalesShowScope({message:"Giá vé Minh Vương?",shows});assert.deepEqual(scopeVerifiedShows(shows,scope).map(s=>s.id),["minh-vuong-0512"]);assert.match(salesTurnInstruction(scope),/Không quảng cáo, báo giá, liệt kê hoặc đề xuất show khác/);});
