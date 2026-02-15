---

## **Backend README (ParkFasto Backend)**


# ParkFasto Backend

## Project Overview
This is the backend API for ParkFasto, the smart parking management system.  
It provides endpoints for:

- User authentication and management
- Parking lot management (availability, booking, updates)
- Payment and token-based access management
- Admin dashboards and reports

The backend handles all data logic, authentication, and communication with the database.

---

## Tech Stack

- **Framework:** Node.js + Express.js
- **Database:** MongoDB (with Mongoose ORM)
- **Authentication:** JWT-based token system
- **Email Notifications:** Nodemailer
- **Environment Management:** dotenv
- **Error Handling:** Custom error middleware
- **Deployment:** Render or similar backend hosting

---


## How It Works

1. Frontend sends HTTP requests to backend endpoints.
2. Backend validates requests (authentication, input validation).
3. Business logic is executed in controllers.
4. Data is read/written in MongoDB.
5. JWT tokens are issued and verified for secure access.
6. Notifications or emails are sent using utility functions.

---

## Setup & Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run production
npm start