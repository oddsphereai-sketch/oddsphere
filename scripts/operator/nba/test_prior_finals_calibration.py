import math
import unittest
import numpy as np
from scipy.linalg import cho_factor, cho_solve
from prior_finals_calibration import likelihood, posterior

class CalibrationMath(unittest.TestCase):
    def setUp(self):
        self.days = np.array([1., 1., 2., 5., 5., 5.])
        self.values = np.array([-3., 4., 2., -1., 7., 3.])
        self.x = np.unique(self.days)
        self.n = np.array([sum(self.days == d) for d in self.x])
        self.m = np.array([self.values[self.days == d].mean() for d in self.x])
        self.sse = np.array([sum((self.values[self.days == d] - mu)**2) for d, mu in zip(self.x, self.m)])
        self.params = np.array([5., 11., 3.])

    def test_grouped_exact_likelihood(self):
        s, noise, length = self.params
        covariance = s * np.exp(-abs(self.days[:, None] - self.days[None, :])/length) + noise*np.eye(len(self.days))
        f = cho_factor(covariance, lower=True)
        dense = .5 * (len(self.days)*math.log(2*math.pi) + 2*np.log(np.diag(f[0])).sum() + self.values @ cho_solve(f, self.values))
        grouped, _ = likelihood(np.log(self.params), self.x, self.n, self.m, self.sse)
        self.assertAlmostEqual(grouped, dense, places=11)

    def test_gradient_finite_difference(self):
        log_params = np.log(self.params)
        _, analytic = likelihood(log_params, self.x, self.n, self.m, self.sse)
        epsilon = 1e-5
        for index in range(3):
            delta = np.eye(3)[index]*epsilon
            numeric = (likelihood(log_params+delta, self.x, self.n, self.m, self.sse)[0] - likelihood(log_params-delta, self.x, self.n, self.m, self.sse)[0])/(2*epsilon)
            self.assertAlmostEqual(analytic[index], numeric, places=7)

    def test_scalar_dense_posterior_same_day_and_later(self):
        s, noise, length = self.params
        covariance = s*np.exp(-abs(self.days[:, None]-self.days[None, :])/length) + noise*np.eye(len(self.days))
        f = cho_factor(covariance, lower=True)
        for target in (5., 6., 50.):
            cross = s*np.exp(-abs(target-self.days)/length)
            dense = (cross @ cho_solve(f, self.values), s-cross @ cho_solve(f, cross))
            np.testing.assert_allclose(posterior(self.params, self.x, self.n, self.m, target), dense, rtol=1e-12, atol=1e-12)

    def test_zero_source(self):
        self.assertEqual(posterior(self.params, [], [], [], 3), (0., 5.))

if __name__ == '__main__':
    unittest.main()
