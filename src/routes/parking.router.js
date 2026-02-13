const express = require("express");
const {
  getAllParkingLots,
  getActiveSession,
  startSession,
  bookParking,
  getUserBookings,
  cancelBooking,
  completeSession,
  guardEntry,
  guardExit,
} = require("../controller/parking.controller");
const { isauthenticated, IsGuardOrAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/lots", getAllParkingLots);
router.get("/active-session", isauthenticated, getActiveSession);
router.post("/start-session", isauthenticated, startSession);
router.post("/book", isauthenticated, bookParking);
router.get("/bookings", isauthenticated, getUserBookings);
router.patch("/bookings/:bookingId/cancel", isauthenticated, cancelBooking);
router.post("/complete-session", isauthenticated, completeSession);

// Guard routes
router.post("/guard/entry", isauthenticated, IsGuardOrAdmin, guardEntry);
router.post("/guard/exit", isauthenticated, IsGuardOrAdmin, guardExit);

module.exports = router;
