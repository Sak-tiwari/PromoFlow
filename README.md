# PromoFlow
Automated Best Coupon Checkout Extension PromoFlow is a high-performance Chrome extension that algorithmically finds, ranks, and applies the optimal combination of discount coupons at e-commerce checkouts. Instead of relying on slow, sequential trial-and-error, it models savings optimization as a Data Structures &amp; Algorithms (DSA) problem.

Key Technical FeaturesAutomated Page Detection: Identifies supported checkout forms and instantly fetches merchant codes.  Greedy Best-Coupon Selection: Ranks candidate coupons by discount value to apply the most promising options first.  Knapsack-Style Stacking (DP): Computes optimal multi-coupon combinations under stacking restrictions using Dynamic Programming.  Session Deduplication & Cache: Logs failed attempts to prevent redundant site submissions and avoid rate limiting.  Heap-Based Cleanup: Routinely purges expired codes in logarithmic time

Currently This works on Shopify stores... Will keep updating!
