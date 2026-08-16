# Database Map

> All models below are **PROTECTED** — do not modify existing fields or collection names.

---

## Student (`students`)
| Field | Type | Validation |
|-------|------|-----------|
| firstName | String | — |
| lastName | String | — |
| name | String | — |
| domain | String | — |
| whatsapp | String | — |
| email | String | unique |
| collegeName | String | — |
| tenure | String | — |
| joiningDate | Date | — |
| employeeId | String | unique |
| password | String | hashed |
| certificateApprovedByCoordinator | Boolean | default: false |
| v2Onboarded | Boolean | default: false |
| v2DurationType | String | — |
| lastActiveDate | Date | — |
**Refs:** None  
**Status:** 🔒 PROTECTED

---

## HR (`hrs`)
| Field | Type | Validation |
|-------|------|-----------|
| username | String | unique |
| email | String | unique |
| password | String | hashed |
| name | String | — |
| role | String | default: 'hr' |
| employeeId | String | — |
| promotedFrom | String | — |
**Refs:** None  
**Status:** 🔒 PROTECTED

---

## Coordinator (`coordinators`)
| Field | Type | Validation |
|-------|------|-----------|
| username | String | unique |
| email | String | unique |
| password | String | hashed |
| name | String | — |
| domain | String | — |
| employeeId | String | — |
| promotedFrom | String | — |
**Refs:** None  
**Status:** 🔒 PROTECTED

---

## Attendance (`attendances`)
| Field | Type | Validation |
|-------|------|-----------|
| studentId | ObjectId | ref: Student |
| employeeId | String | — |
| domain | String | — |
| date | Date | — |
| dateKey | String | — |
| status | String | enum: present/absent/late |
| markedBy | String | — |
| coordinatorId | ObjectId | — |
**Refs:** Student  
**Status:** 🔒 PROTECTED

---

## Payment (`payments`)
| Field | Type | Validation |
|-------|------|-----------|
| orderId | String | — |
| invoiceRef | String | — |
| studentId | String | — |
| amountRupees | Number | — |
| status | String | — |
| txnUtr | String | — |
| customerEmail | String | — |
**Refs:** None (studentId is String, not ObjectId)  
**Status:** 🔒 PROTECTED

---

## Notification (`notifications`)
| Field | Type | Validation |
|-------|------|-----------|
| title | String | required |
| message | String | required |
| type | String | — |
| targetType | String | — |
| targetDomain | String | — |
| readBy | [ObjectId] | — |
**Status:** 🔒 PROTECTED

---

## EcosystemUser (`ecosystemusers`) — Phase 1 Addition
| Field | Type | Validation |
|-------|------|-----------|
| role | String | enum: founder/mentor/investor/contractor/student |
| fullName | String | required |
| email | String | unique, required |
| password | String | required |
| phone | String | default: '' |
| bio | String | default: '' |
| isVerified | Boolean | default: false |
| isActive | Boolean | default: true |
| createdAt | Date | — |
**Status:** ✅ NEW (Phase 1)

---

## TalentProfile (`talentprofiles`) — Phase 1 Addition
| Field | Type | Validation |
|-------|------|-----------|
| userId | ObjectId | ref: EcosystemUser, unique, required |
| headline | String | maxlength: 120 |
| bio | String | maxlength: 1000 |
| skills | [{name, level}] | level enum |
| experience | [{title, company, dates, current, description}] | — |
| education | [{degree, institution, year, grade}] | — |
| portfolio | [{title, url, description, tags}] | — |
| socialLinks | {linkedin, github, twitter, website} | — |
| availability | String | enum |
| openTo | [String] | enum values |
| visibility | String | enum: public/network/private |
| profileScore | Number | 0–100, auto-calculated |
| isVerified | Boolean | default: false |
| verifiedBy | ObjectId | ref: EcosystemUser |
**Status:** ✅ NEW (Phase 1)

---

## PaymentTransaction (`paymenttransactions`) — Phase 1 Addition
| Field | Type | Validation |
|-------|------|-----------|
| provider | String | enum: setu/razorpay/stripe/manual |
| providerOrderId | String | — |
| providerPaymentId | String | — |
| amount | Number | min: 0, required |
| currency | String | default: INR |
| status | String | enum: CREATED/PENDING/PAID/FAILED/REFUNDED/PARTIALLY_REFUNDED |
| description | String | — |
| initiatedBy | ObjectId | ref: EcosystemUser |
| metadata | Map | — |
| webhookEvents | [{event, payload, receivedAt}] | — |
| refunds | [{refundId, amount, reason, status, createdAt}] | — |
**Index:** compound { provider: 1, providerOrderId: 1 }  
**Status:** ✅ NEW (Phase 1)
