# 🎯 Approval Flow Configuration System - Implementation Complete

## Overview
Dynamic, configurable approval workflow system that allows admins to create multiple approval flows and assign them to projects.

---

## What Was Implemented

### ✅ **1. Database Schema Updates**

**New Models:**

#### `ApprovalFlow`
```prisma
model ApprovalFlow {
  id          String  @id @default(uuid())
  name        String  @unique  // "BU_HEAD → OP", "Director → BU_HEAD → OP"
  description String?
  isDefault   Boolean @default(false)
  isActive    Boolean @default(true)

  steps   ApprovalStep[]
  projects Project[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

#### `ApprovalStep`
```prisma
model ApprovalStep {
  id    String @id @default(uuid())
  flowId String
  order Int
  role  String  // "BU_HEAD", "OP", "DIRECTOR", "FINANCE", etc.
  
  requiresAll Int @default(1)  // 0 = Any one approver, 1 = All approvers
  canReject   Boolean @default(true)
  
  flow ApprovalFlow @relation(fields: [flowId], references: [id], onDelete: Cascade)
}
```

#### **Project Model Updates**
```prisma
model Project {
  // ... existing fields ...
  
  // 🔥 NEW
  approvalFlowId  String?
  approvalFlow    ApprovalFlow?  @relation(fields: [approvalFlowId], references: [id])
  approvalEnabled Boolean        @default(true)  // Can disable per project
}
```

---

### ✅ **2. Migration Created**

**File:** `prisma/migrations/20260503000000_add_approval_flow_configuration/migration.sql`

- Creates `ApprovalFlow` table
- Creates `ApprovalStep` table  
- Adds `approvalFlowId` and `approvalEnabled` columns to Project table
- Sets up foreign key relationships

---

### ✅ **3. Service Layer**

**File:** `src/modules/approval/approval.flow.service.ts`

Complete service with all CRUD operations:

```typescript
class ApprovalFlowService {
  // Create new approval flow with steps
  static async createFlow(data: CreateApprovalFlowInput)
  
  // Get all flows (with optional active filter)
  static async getAllFlows(onlyActive?: boolean)
  
  // Get flow by ID
  static async getFlowById(flowId: string)
  
  // Update flow details and steps
  static async updateFlow(flowId: string, data: UpdateApprovalFlowInput)
  
  // Delete flow (with safety checks)
  static async deleteFlow(flowId: string)
  
  // Get default flow
  static async getDefaultFlow()
  
  // Get users by role
  static async getUsersByRoleInFlow(role: string)
  
  // Set flow as default
  static async setDefaultFlow(flowId: string)
  
  // Assign flow to project
  static async assignFlowToProject(projectId: string, flowId: string)
  
  // Toggle approval for project
  static async toggleProjectApproval(projectId: string, enabled: boolean)
}
```

---

### ✅ **4. Controllers**

#### **ApprovalFlowController**
**File:** `src/modules/approval/approval.flow.controller.ts`

Endpoints for admin to manage approval flows:
- POST - Create new flow
- GET - List all flows  
- GET /:id - Get specific flow
- PATCH /:id - Update flow
- DELETE /:id - Delete flow
- POST /:id/set-default - Set as default

#### **AdminProjectApprovalController**
**File:** `src/modules/approval/admin.project.approval.controller.ts`

Endpoints for super admin to configure project approvals:
- PATCH `/api/admin/projects/{projectId}/approval-config` - Assign flow or disable approval
- GET `/api/admin/projects/{projectId}/approval-config` - View project's approval config

---

### ✅ **5. Routes**

**File:** `src/modules/approval/approval.flow.routes.ts`

```
POST   /api/admin/approval-flows           # Create flow
GET    /api/admin/approval-flows           # List flows
GET    /api/admin/approval-flows/:flowId   # Get flow by ID
PATCH  /api/admin/approval-flows/:flowId   # Update flow
DELETE /api/admin/approval-flows/:flowId   # Delete flow
POST   /api/admin/approval-flows/:flowId/set-default  # Set as default
GET    /api/admin/approval-flows/default   # Get default flow
PATCH  /api/admin/projects/:projectId/approval-config # Configure project
```

All routes protected with:
- `authenticate` middleware
- `authorize("ADMIN", ...)` RBAC checks

---

### ✅ **6. Updated Approval Service**

**File:** `src/modules/approval/approval.service.ts`

Added new flow-based submission logic:

```typescript
// New method that uses approval flows
async submitProjectForApprovalUsingFlow(projectId: string, userId: string)

// Updated to delegate to new flow system
async submitProjectForApproval(projectId: string, userId: string)
  // Now calls submitProjectForApprovalUsingFlow()
```

**Features:**
- Auto-detects project's assigned flow (or uses default)
- Creates approval records based on flow steps
- Respects `approvalEnabled` flag per project
- Notifies approvers with flow/step information
- Supports both "requiresAll" and "any one approver" logic

---

### ✅ **7. Seed Data**

**File:** `prisma/seed.ts`

Added default approval flows during seeding:

```
✅ Flow 1: "BU_HEAD → OP" (Default)
   - Step 1: BU_HEAD (requiresAll: true)
   - Step 2: OP (requiresAll: false)

✅ Flow 2: "Director → BU_HEAD → OP" (Optional)
   - Step 1: DIRECTOR (requiresAll: false)
   - Step 2: BU_HEAD (requiresAll: true)
   - Step 3: OP (requiresAll: false)
```

---

### ✅ **8. App Integration**

**File:** `src/app.ts`

- Imported new `approvalFlowRoutes`
- Registered routes at `/api/admin/approval-flows`

---

## API Usage Examples

### **1. Create Approval Flow (Admin)**

```bash
POST /api/admin/approval-flows
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "Finance Review → OP Approval",
  "description": "For projects requiring finance review",
  "isDefault": false,
  "steps": [
    {
      "order": 1,
      "role": "FINANCE",
      "requiresAll": 1,
      "canReject": true
    },
    {
      "order": 2,
      "role": "OP",
      "requiresAll": 0,
      "canReject": true
    }
  ]
}
```

### **2. Get All Flows**

```bash
GET /api/admin/approval-flows?active=true
Authorization: Bearer <token>
```

### **3. Set Default Flow**

```bash
POST /api/admin/approval-flows/{flowId}/set-default
Authorization: Bearer <token>
```

### **4. Configure Project Approval (Super Admin)**

```bash
PATCH /api/admin/projects/{projectId}/approval-config
Content-Type: application/json
Authorization: Bearer <token>

{
  "approvalFlowId": "flow-456",
  "approvalEnabled": true
}
```

### **5. Disable Approval for Project (Super Admin)**

```bash
PATCH /api/admin/projects/{projectId}/approval-config
Content-Type: application/json
Authorization: Bearer <token>

{
  "approvalFlowId": null,
  "approvalEnabled": false
}
```

---

## How It Works

### **Flow-Based Submission Process**

```
User Submits Project
       ↓
Check if approvalEnabled = false
├─YES → Auto-approve to ACTIVE
└─NO → Continue
       ↓
Get Project's ApprovalFlow
├─If assigned → Use assigned flow
└─If not assigned → Use default flow
       ↓
For each step in flow:
  ├─Get users with required role
  ├─Create approval records
  └─Notify approvers
       ↓
Update project status
├─If first step is OP → FOR_APPROVAL
└─Otherwise → FOR_REVIEW
       ↓
Process follows normal approval logic
```

---

## Key Features

✅ **Global Default Flow** - One flow marked as default for new projects
✅ **Reusable Flows** - Create once, assign to many projects
✅ **Per-Project Override** - Super admin can assign different flows to different projects
✅ **Approval Control** - Can fully disable approval for specific projects
✅ **Flexible Approval Rules** - `requiresAll` flag controls approval strategy:
  - `requiresAll: 1` = All users in role must approve
  - `requiresAll: 0` = Any one user in role can approve
✅ **Audit Trail** - Integration with existing approval audit log system
✅ **Role-Based** - Uses existing user roles to determine approvers
✅ **Backwards Compatible** - Existing approval logic still works if no flow assigned
✅ **Safe Deletions** - Can't delete default flow if projects depend on it

---

## Setup Instructions (Local)

### **Step 1: Regenerate Prisma Client**

```bash
cd /path/to/bucket-vision-backend
npx prisma generate
```

### **Step 2: Create Database Migration**

```bash
npx prisma migrate dev --name add_approval_flow_configuration
```

### **Step 3: Seed Default Flows**

```bash
npx prisma db seed
```

### **Step 4: Verify**

```bash
npm run dev
# Check for compilation errors - should be none now
```

---

## Database Relationships

```
ApprovalFlow (1)
    ├─→ (many) ApprovalStep
    ├─→ (many) Project
    
Project (1)
    ├─→ (0..1) ApprovalFlow
    
ApprovalStep (many)
    └─→ (1) ApprovalFlow
```

---

## Testing Checklist

- [ ] Create new approval flow via API
- [ ] List approval flows
- [ ] Get specific flow
- [ ] Update flow (add/remove steps)
- [ ] Set default flow
- [ ] Assign flow to project
- [ ] Submit project - should use assigned flow
- [ ] Disable approval for project
- [ ] Submit disabled project - should auto-approve
- [ ] Submit project without assigned flow - should use default
- [ ] Delete flow not in use
- [ ] Try to delete default flow with projects - should fail

---

## Future Enhancements

1. **Conditional Flows** - Routes based on project category/risk level
2. **Role Hierarchy** - Automatic escalation if primary approver unavailable
3. **Time-Based Workflows** - Different flows based on project timeline
4. **SLA Tracking** - Monitor approval cycle time
5. **Workflow Templates** - Clone existing flows
6. **Notifications** - Configurable reminder notifications for pending approvals

---

## Files Created/Modified

### **Created:**
- `src/modules/approval/approval.flow.service.ts` ✅
- `src/modules/approval/approval.flow.controller.ts` ✅
- `src/modules/approval/approval.flow.routes.ts` ✅
- `src/modules/approval/admin.project.approval.controller.ts` ✅
- `prisma/migrations/20260503000000_add_approval_flow_configuration/migration.sql` ✅

### **Modified:**
- `prisma/schema.prisma` ✅ (Added ApprovalFlow, ApprovalStep, Project updates)
- `src/modules/approval/approval.service.ts` ✅ (Added flow-based submission)
- `src/app.ts` ✅ (Registered approval flow routes)
- `prisma/seed.ts` ✅ (Added default flow seeding)

---

## Status: ✅ READY FOR TESTING

All code is implemented and ready. Just run Setup Step 1 locally to regenerate Prisma types, then you can start testing the API!
