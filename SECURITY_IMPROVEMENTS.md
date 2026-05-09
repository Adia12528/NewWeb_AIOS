# Security & Access Control Improvements

## Overview
This document outlines all role-based access control and security improvements implemented for AIOS-Lite.

## Backend Security (server.js)

### 1. Restricted State API to Leader Only ✓
- **Endpoint**: `POST /api/state`
- **Change**: Added role check - only `role === 'leader'` can replace entire state
- **Reason**: Prevents members from overwriting global state
- **Code**: 
  ```javascript
  if (user.role !== 'leader') {
    return res.status(403).json({ error: 'Only leader can update global state' });
  }
  ```

### 2. Member Task Update Authorization ✓
- **Endpoint**: `POST /api/member/:id/task`
- **Existing Check**: Members can only update their own tasks (memberIndex check)
- **Authorization**: 
  - Leader: Can update ANY member's tasks
  - Member: Can only update their own tasks (memberIndex === parseInt(memberId))

### 3. User Management (Create/Update/Delete) ✓
- **Endpoints**: `POST /api/users`, `PATCH /api/users/:username`, `DELETE /api/users/:username`
- **Restriction**: Leader only
- **Code**: `if (!user || user.role !== 'leader') return 403`

---

## Frontend Security (index.html)

### 1. Member Account Assignment - Leader Only ✓
- **Function**: `saveMemberAccount(memberIndex)`
- **Added Check**: 
  ```javascript
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== 'leader') {
    alert('Only the team leader can assign usernames and passwords.');
    return;
  }
  ```
- **Location**: Line 2804

### 2. Task Edit Buttons - Role-Based Disabling ✓
- **Function**: `makeModalItem()` in `focusTeamMember()`
- **Changes**:
  - Calculate `canEdit = currentUser.role === 'leader' || (currentUser.role === 'member' && currentUser.memberIndex === memberIdx)`
  - Disable buttons with CSS: `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`
  - Only leaders and member viewing own checklist can edit
- **Location**: Line 3479

### 3. Modal Task State Changes - Authorization Check ✓
- **Function**: `setModalTaskState(key, memberIdx, state)`
- **Added Check**:
  ```javascript
  const currentUser = getCurrentUser();
  if (currentUser.role !== 'leader' && currentUser.memberIndex !== memberIdx) {
    alert('You can only edit your own tasks.');
    return;
  }
  ```
- **Location**: Line 3543

### 4. Checklist Task State Changes - Authorization Check ✓
- **Function**: `setMemberChecklistTaskState(key, memberIdx, state)`
- **Added Check**: Same as above
- **Location**: Line 3455

### 5. Checklist Panel Toggle - Member Restriction ✓
- **Function**: `toggleMemberPanel(idx)`
- **Added Check**:
  ```javascript
  const currentUser = getCurrentUser();
  if (currentUser && currentUser.role === 'member' && currentUser.memberIndex !== idx) {
    alert('You can only view your own checklist.');
    return;
  }
  ```
- **Location**: Line 3435
- **Effect**: Members see alerts when trying to expand other members' checklists

---

## Frontend UI Restrictions (index.html)

### 1. "Assign Member Logins" Section - Leader Only ✓
- **HTML Element**: `id="leader-unlocked"`
- **Display**: Only shown after leader password validation
- **Function**: `unlockLeaderPanel()`
- **Members Never See**: This entire section is hidden for non-leader users

### 2. Team Management Panel - Leader Only ✓
- **HTML Element**: `id="leader-management-panel"`
- **Functions**: 
  - `showLeaderManagementPanel()` - Only called by `showLeaderUI()`
  - `loadTeamMembers()` - Fetches `/api/users` which already restricts to leader
  - Backend also restricts GET /api/users to leader only

### 3. Member Visibility ✓
- **Function**: `hideOtherTeamMembers(memberIndex)`
- **Effect**: Members only see their own checklist panels
- **Members Cannot**: View or expand other members' checklists in detail

---

## Default Backend URL for GitHub Pages ✓
- **Function**: `resolveBackendOrigin()`
- **Updated Logic**:
  ```javascript
  if (location.protocol === 'file:' || location.hostname === 'localhost') {
    return 'http://localhost:3001'; // Local development
  }
  return 'https://newweb-aios.onrender.com'; // GitHub Pages default
  ```
- **Location**: Line 2312
- **Effect**: GitHub Pages sites automatically connect to Render backend without manual URL entry

---

## Summary of Access Controls

### Leader Capabilities ✓
- ✓ View all team members' checklists
- ✓ Edit any member's tasks
- ✓ Create/update/delete member accounts
- ✓ Assign usernames and passwords
- ✓ Update team member names
- ✓ View entire global state
- ✓ Manage all configuration

### Member Capabilities ✓
- ✓ View own checklist only
- ✓ Edit only own tasks
- ✓ See other members' progress (read-only)
- ✓ See leader's progress (read-only)
- ✓ Cannot expand other member details
- ✓ Cannot modify other members' tasks
- ✓ Cannot access user management
- ✓ Cannot assign passwords to anyone

---

## Tested Scenarios

### ✓ Scenario 1: Leader Access
- Login as adisoni01/A12528@as
- See "Assign Member Logins" section
- See Team Management panel
- Can edit all members' tasks
- Can create new member accounts

### ✓ Scenario 2: Member Task Isolation
- Frontend prevents member from expanding other members' checklists
- Frontend disables edit buttons for other members' tasks with visual feedback
- Backend returns 403 if member tries to POST to another member's task endpoint
- Alert message: "You can only edit your own tasks."

### ✓ Scenario 3: Default Backend URL
- GitHub Pages: Defaults to https://newweb-aios.onrender.com
- Local file://: Defaults to http://localhost:3001
- Can be overridden by user via "SAVE BACKEND URL" button

### ✓ Scenario 4: State Persistence
- Members cannot POST to /api/state directly
- Backend enforces leader-only access with 403 response
- Members can only update via /api/member/:id/task endpoint

---

## Files Modified
1. **server.js**: Added leader-only check to `/api/state` POST
2. **index.html**: 
   - Added authorization checks to `saveMemberAccount()`
   - Added authorization checks to `setModalTaskState()`
   - Added authorization checks to `setMemberChecklistTaskState()`
   - Added authorization checks to `toggleMemberPanel()`
   - Updated `makeModalItem()` to disable buttons for non-authorized users
   - Updated `resolveBackendOrigin()` to set default GitHub Pages URL
   - Updated button rendering to show disabled state for unauthorized edits

---

## Testing Checklist
- [x] Leader can assign usernames/passwords
- [x] Member cannot access user assignment UI
- [x] Member cannot expand other members' checklists
- [x] Member cannot edit other members' tasks (UI blocked)
- [x] Member cannot edit other members' tasks (backend 403)
- [x] Leader can edit all members' tasks
- [x] Default backend URL set for GitHub Pages
- [x] Local development uses localhost:3001
- [x] State API restricted to leader only
- [x] No syntax errors in code

---

## Deployment Notes
- Render backend will reject any non-leader attempts to POST /api/state
- Members will see alert messages if they try to bypass UI restrictions
- GitHub Pages sites will automatically connect to https://newweb-aios.onrender.com
- All role-based access is enforced at both frontend (UX) and backend (security)
