import math
import unittest
import numpy as np
from scipy.linalg import null_space,cho_factor,cho_solve
from learned_shrinkage import likelihood,spectrum,fit,training_rows

class LearnedShrinkage(unittest.TestCase):
    def setUp(self):
        self.x=np.array([[1.,3.],[3.,-1.],[0.,4.],[-2.,3.],[2.,1.],[-3.,-2.],[4.,0.],[-1.,2.]])
        self.y=np.array([3.,-1.,5.,-6.,7.,-4.,2.,-2.])
        self.parameters=np.log([2.,5.])
        self.arguments=spectrum(self.x,self.y)[:4]

    def test_dense_restricted_likelihood(self):
        contrast=null_space(np.ones((1,len(self.y))))
        projected=contrast.T@self.x
        covariance=5*np.eye(len(self.y)-1)+2*projected@projected.T
        target=contrast.T@self.y
        factor=cho_factor(covariance,lower=True)
        dense=.5*((len(self.y)-1)*math.log(2*math.pi)+2*np.log(np.diag(factor[0])).sum()+target@cho_solve(factor,target))
        value,_=likelihood(self.parameters,*self.arguments)
        self.assertAlmostEqual(value,dense,places=10)

    def test_analytic_gradient(self):
        _,g=likelihood(self.parameters,*self.arguments)
        for i in range(2):
            delta=np.eye(2)[i]*1e-5
            numeric=(likelihood(self.parameters+delta,*self.arguments)[0]-likelihood(self.parameters-delta,*self.arguments)[0])/2e-5
            self.assertAlmostEqual(g[i],numeric,places=7)

    def test_posterior_and_intercept_translation(self):
        head,_=fit(self.x,self.y)
        shifted,_=fit(self.x+7,self.y+15)
        # Relative-objective optimizer tolerance permits small parameter jitter.
        np.testing.assert_allclose(head['coefficients'][:-1],shifted['coefficients'][:-1],rtol=1e-6,atol=1e-7)
        beta=np.array(head['coefficients'][:-1])
        centered=self.x-self.x.mean(axis=0)
        exact=np.linalg.solve(centered.T@centered+head['alpha']*np.eye(2),centered.T@(self.y-self.y.mean()))
        np.testing.assert_allclose(beta,exact,atol=1e-12,rtol=1e-12)
        shifted_predictions=(self.x+7)@np.array(shifted['coefficients'][:-1])+shifted['coefficients'][-1]
        predictions=self.x@beta+head['coefficients'][-1]
        np.testing.assert_allclose(shifted_predictions,predictions+15,rtol=1e-6,atol=1e-7)

class TrainingBoundary(unittest.TestCase):
    def test_target_future_poison_cannot_enter_fit(self):
        train={'season':2022,'finalAvailableAt':'2023-04-10T00:00:00Z','features':{'x':1},'actualTotal':200}
        future={'season':2023,'finalAvailableAt':'2023-11-01T00:00:00Z','features':None,'actualTotal':float('nan')}
        late={'season':2022,'finalAvailableAt':'2024-04-10T00:00:00Z','features':None}
        self.assertEqual(training_rows([train,future,late],'2023-10-24T22:30:00Z'),[train])

if __name__=='__main__':unittest.main()
